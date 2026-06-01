/**
 * Live-streaming custom message in Pi's chat flow during compaction.
 *
 * Pattern (all documented Pi APIs — see docs/tui-streaming-patterns.md):
 * 1. Capture TUI ref from widget factory
 * 2. Register custom message renderer (toolPendingBg → customMessageBg)
 * 3. Filter from LLM context via pi.on('context')
 * 4. Hide on compaction via pi.on('session_compact')
 * 5. Send message (renders in chat)
 * 6. Dual mutation (msgObj.content + component refs) + TUI.requestRender()
 */

import {
	type ExtensionAPI,
	getMarkdownTheme,
	type ThemeColor,
} from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
import { Box, Markdown, Spacer, Text } from '@earendil-works/pi-tui';

import type { HookContext, SummaryProgress } from '@live-compaction/types';

const CUSTOM_TYPE = 'live-compaction-stream';
const THROTTLE_MS = 150;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Shared mutable state between the registered renderer and the progress
 * factory returned by {@link registerCompactionChatMessage}. Both closures
 * close over the same object so dual mutation is automatic.
 */
interface ChatState {
	phase: 'idle' | 'streaming' | 'done';
	msgObj: { content: unknown } | null;
	mdRef: InstanceType<typeof Markdown> | null;
	headerRef: InstanceType<typeof Text> | null;
	tuiRef: TUI | null;
	themeRef: { fg: (key: ThemeColor, text: string) => string } | null;
	tick: number;
}

function buildHeaderText(
	phase: ChatState['phase'],
	lineCount: number,
	theme: { fg: (key: ThemeColor, text: string) => string },
	tick: number,
): string {
	if (phase === 'done') {
		return (
			theme.fg('accent', '\x1b[1m[compaction · done]\x1b[22m') +
			' ' +
			theme.fg('muted', `${lineCount} lines`)
		);
	}
	const spinner = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
	return (
		theme.fg('accent', `\x1b[1m${spinner} [compaction · streaming]\x1b[22m`) +
		' ' +
		theme.fg('muted', `${lineCount} lines`)
	);
}

/**
 * One-time setup: register renderer, context filter, and compaction cleanup.
 * Call once during extension factory. Pi clears renderer/handler registrations
 * on reload, so this is idempotent across reloads.
 *
 * Returns a factory that creates a chat-flow {@link SummaryProgress} for each
 * compaction run — sharing renderer state via closure.
 */
export function registerCompactionChatMessage(
	pi: ExtensionAPI,
): (ctx: HookContext) => SummaryProgress | undefined {
	const state: ChatState = {
		phase: 'idle',
		msgObj: null,
		mdRef: null,
		headerRef: null,
		tuiRef: null,
		themeRef: null,
		tick: 0,
	};

	// ---- Renderer (function form — required, object form silently breaks) ----
	pi.registerMessageRenderer(CUSTOM_TYPE, (message, options, theme) => {
		state.msgObj = message;
		state.themeRef = theme;
		const bgKey = state.phase === 'done' ? 'customMessageBg' : 'toolPendingBg';
		const bgFn = (t: string) => theme.bg(bgKey, t);
		const box = new Box(1, 1, bgFn);

		const content = String(message.content);
		const lines = content.split('\n').length;
		const header = new Text(buildHeaderText(state.phase, lines, theme, state.tick), 0, 0);
		box.addChild(header);
		state.headerRef = header;

		if (options.expanded) {
			box.addChild(new Spacer(1));
			const md = new Markdown(content, 0, 0, getMarkdownTheme(), {
				color: (t: string) => theme.fg('customMessageText', t),
			});
			box.addChild(md);
			state.mdRef = md;
		} else {
			state.mdRef = null;
		}

		return box;
	});

	// ---- Filter from LLM context — zero cost to model ----
	pi.on('context', (event) => ({
		messages: event.messages.filter(
			(m) => !(m.role === 'custom' && (m as { customType?: string }).customType === CUSTOM_TYPE),
		),
	}));

	// ---- Hide on compaction commit (fires before rebuildChatFromMessages) ----
	pi.on('session_compact', (_event, ctx) => {
		const entry = ctx.sessionManager
			.getEntries()
			.findLast((e) => e.type === 'custom_message' && e.customType === CUSTOM_TYPE);
		if (entry) (entry as { display: unknown }).display = undefined;

		// Reset for next compaction cycle
		state.phase = 'idle';
		state.msgObj = null;
		state.mdRef = null;
		state.headerRef = null;
		state.themeRef = null;
		state.tick = 0;
	});

	// ---- Progress factory — shares `state` with renderer above ----
	return function makeChatSummaryProgress(ctx: HookContext): SummaryProgress | undefined {
		if (!ctx.hasUI) return undefined;

		let lastUpdate = 0;
		let started = false;

		// Capture TUI ref (documented: tui.md Pattern 6)
		const captureTui = () => {
			ctx.ui.setWidget?.(
				'_tui-cap',
				(tui) => {
					state.tuiRef = tui as TUI;
					return new Spacer(0);
				},
				{ placement: 'belowEditor' },
			);
			setTimeout(() => ctx.ui.setWidget?.('_tui-cap', undefined), 100);
		};

		return {
			start(modelLabel: string, _tokensBefore: number) {
				started = true;
				state.phase = 'streaming';
				captureTui();
				ctx.ui.setWorkingMessage?.(`Compacting with ${modelLabel}…`);

				// Render initial message in chat
				pi.sendMessage({
					customType: CUSTOM_TYPE,
					content: '_Waiting for model output…_',
					display: true,
				});
			},

			update(text: string) {
				if (!started) return;
				const now = Date.now();
				if (now - lastUpdate < THROTTLE_MS) return;
				lastUpdate = now;

				const lineCount = text ? text.split('\n').length : 0;
				ctx.ui.setWorkingMessage?.(`Compacting · ${lineCount} lines`);

				// Dual mutation — rebuild-safe + immediate visual
				if (state.msgObj) {
					state.msgObj.content = text;
				}
				state.mdRef?.setText(text);
				if (state.headerRef && state.themeRef) {
					state.tick++;
					state.headerRef.setText(buildHeaderText(state.phase, lineCount, state.themeRef, state.tick));
				}
				state.tuiRef?.requestRender();
			},

			finish() {
				started = false;
				state.phase = 'done';
				ctx.ui.setWorkingMessage?.();
				// Trigger rebuild to apply customMessageBg
				state.tuiRef?.requestRender();
			},

			fail(message: string) {
				started = false;
				state.phase = 'idle';
				ctx.ui.setWorkingMessage?.();
				ctx.ui.setWidget?.('live-compaction-error', [`Compaction failed: ${message}`], {
					placement: 'aboveEditor',
				});
			},
		};
	};
}
