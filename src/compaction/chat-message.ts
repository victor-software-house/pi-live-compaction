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
	closeSync,
	fchmodSync,
	fsyncSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
	type ExtensionAPI,
	getMarkdownTheme,
	type ThemeColor,
} from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
import { Box, Markdown, Spacer, Text } from '@earendil-works/pi-tui';

import type { HookContext, SummaryProgress } from '@live-compaction/types';
import { safeUI } from '@live-compaction/types';

const CUSTOM_TYPE = 'live-compaction-stream';
const THROTTLE_MS = 150;
let rewriteCounter = 0;

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
}

function buildHeaderText(
	phase: ChatState['phase'],
	lineCount: number,
	theme: { fg: (key: ThemeColor, text: string) => string },
): string {
	const label = phase === 'done' ? 'done' : 'streaming';
	return (
		theme.fg('accent', `\x1b[1m[compaction · ${label}]\x1b[22m`) +
		' ' +
		theme.fg('muted', `${lineCount} lines`)
	);
}

interface MutableCustomMessageEntry extends Record<string, unknown> {
	type: 'custom_message';
	customType: string;
	display: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isLiveCompactionStreamEntry(entry: unknown): entry is MutableCustomMessageEntry {
	return (
		isRecord(entry) &&
		entry.type === 'custom_message' &&
		entry.customType === CUSTOM_TYPE &&
		entry.display !== false
	);
}

function serializeSessionFile(header: unknown, entries: readonly unknown[]): string {
	return `${[header, ...entries].map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

function createTempPath(sessionFile: string, suffix: string): string {
	rewriteCounter += 1;
	return path.join(
		path.dirname(sessionFile),
		`.${path.basename(sessionFile)}.live-compaction-${process.pid}-${rewriteCounter}-${suffix}.tmp`,
	);
}

function writeReplacementFile(
	sessionFile: string,
	content: string,
	mode: number,
	expectedCurrentContent?: string,
): void {
	const tempPath = createTempPath(sessionFile, 'rewrite');
	let fd: number | undefined;
	try {
		fd = openSync(tempPath, 'wx');
		fchmodSync(fd, mode);
		writeFileSync(fd, content, 'utf8');
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;

		if (expectedCurrentContent !== undefined) {
			const currentContent = readFileSync(sessionFile, 'utf8');
			if (currentContent !== expectedCurrentContent) {
				throw new Error('Session file changed while finalizing live compaction stream entry');
			}
		}

		renameSync(tempPath, sessionFile);
	} finally {
		if (fd !== undefined) closeSync(fd);
		rmSync(tempPath, { force: true });
	}
}

function restoreOriginalSessionFile(
	sessionFile: string,
	originalContent: string,
	mode: number,
): void {
	writeReplacementFile(sessionFile, originalContent, mode);
}

function finalizeStreamEntries(ctx: HookContext): void {
	const ui = safeUI(ctx);
	const sessionManager = ctx.sessionManager;
	if (!sessionManager) {
		ui.notify?.(
			'Live compaction stream finalization skipped: session manager is unavailable.',
			'warning',
		);
		return;
	}

	const sessionFile = sessionManager.getSessionFile();
	const header = sessionManager.getHeader();
	if (!sessionFile || !header) {
		ui.notify?.(
			'Live compaction stream finalization skipped: session file is unavailable.',
			'warning',
		);
		return;
	}

	const entries = sessionManager.getEntries();
	const targets = entries.filter(isLiveCompactionStreamEntry);
	if (targets.length === 0) {
		ui.notify?.(
			'Live compaction stream finalization skipped: no stream message entries found.',
			'info',
		);
		return;
	}

	const originalDisplays = targets.map((entry) => ({ entry, display: entry.display }));
	const mode = statSync(sessionFile).mode & 0o777;
	const originalContent = readFileSync(sessionFile, 'utf8');
	const liveOriginalContent = serializeSessionFile(header, entries);

	try {
		if (liveOriginalContent !== originalContent) {
			throw new Error('Live session entries do not match the persisted session file');
		}

		for (const entry of targets) {
			entry.display = false;
		}

		const nextContent = serializeSessionFile(header, entries);
		writeReplacementFile(sessionFile, nextContent, mode, originalContent);

		const persistedContent = readFileSync(sessionFile, 'utf8');
		if (persistedContent !== nextContent) {
			restoreOriginalSessionFile(sessionFile, originalContent, mode);
			throw new Error('Session file verification failed after live compaction finalization');
		}

		ui.notify?.(
			`Live compaction stream finalized: ${targets.length} transient message${targets.length === 1 ? '' : 's'} hidden from resume.`,
			'info',
		);
	} catch (error) {
		for (const original of originalDisplays) {
			original.entry.display = original.display;
		}

		try {
			if (readFileSync(sessionFile, 'utf8') !== originalContent) {
				restoreOriginalSessionFile(sessionFile, originalContent, mode);
			}
		} catch (rollbackError) {
			const message =
				rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
			ui.notify?.(
				`Live compaction stream finalization failed and rollback failed: ${message}`,
				'error',
			);
			return;
		}

		const message = error instanceof Error ? error.message : String(error);
		ui.notify?.(
			`Live compaction stream finalization failed; original session JSONL restored: ${message}`,
			'error',
		);
	}
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
		const header = new Text(buildHeaderText(state.phase, lines, theme), 0, 0);
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
		finalizeStreamEntries(ctx);

		// Reset for next compaction cycle
		state.phase = 'idle';
		state.msgObj = null;
		state.mdRef = null;
		state.headerRef = null;
		state.themeRef = null;
	});

	// ---- Progress factory — shares `state` with renderer above ----
	return function makeChatSummaryProgress(ctx: HookContext): SummaryProgress | undefined {
		if (!ctx.hasUI) return undefined;

		const ui = safeUI(ctx);
		let lastUpdate = 0;
		let started = false;

		// Capture TUI ref (documented: tui.md Pattern 6)
		const captureTui = () => {
			ui.setWidget?.(
				'_tui-cap',
				(tui) => {
					state.tuiRef = tui as TUI;
					return new Spacer(0);
				},
				{ placement: 'belowEditor' },
			);
			setTimeout(() => ui.setWidget?.('_tui-cap', undefined), 100);
		};

		return {
			start(modelLabel: string, _tokensBefore: number) {
				started = true;
				state.phase = 'streaming';
				captureTui();
				ui.setWorkingMessage?.(`Compacting with ${modelLabel}…`);

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
				ui.setWorkingMessage?.(`Compacting · ${lineCount} lines`);

				// Dual mutation — rebuild-safe + immediate visual
				if (state.msgObj) {
					state.msgObj.content = text;
				}
				state.mdRef?.setText(text);
				if (state.headerRef && state.themeRef) {
					state.headerRef.setText(buildHeaderText(state.phase, lineCount, state.themeRef));
				}
				state.tuiRef?.requestRender();
			},

			finish() {
				started = false;
				state.phase = 'done';
				ui.setWorkingMessage?.();
				// Trigger rebuild to apply customMessageBg
				state.tuiRef?.requestRender();
			},

			fail(message: string) {
				started = false;
				state.phase = 'idle';
				ui.setWorkingMessage?.();
				ui.setWidget?.('live-compaction-error', [`Compaction failed: ${message}`], {
					placement: 'aboveEditor',
				});
			},
		};
	};
}
