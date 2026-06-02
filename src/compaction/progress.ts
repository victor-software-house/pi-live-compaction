import { randomUUID } from 'node:crypto';

import {
	CompactionSummaryMessageComponent,
	type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';

import { normalizeOptionalText } from '@live-compaction/config';
import type { HookContext, NotifyLevel, SummaryProgress } from '@live-compaction/types';
import { safeUI } from '@live-compaction/types';

const TASK_STATE_MAX_CHARS = 6000;

export { TASK_STATE_MAX_CHARS };

export function notify(ctx: HookContext, message: string, level: NotifyLevel = 'warning'): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	}
}

export function boundTaskStateBlock(value: string | undefined): string | undefined {
	const normalized = normalizeOptionalText(value);
	if (!normalized) return undefined;
	if (normalized.length <= TASK_STATE_MAX_CHARS) return normalized;
	return `${normalized.slice(0, TASK_STATE_MAX_CHARS)}\n- … task state truncated; call TaskRead after resume.`;
}

export function fetchTaskStateSnapshot(
	events: ExtensionAPI['events'],
	timeoutMs = 750,
): Promise<string | undefined> {
	const requestId = randomUUID();
	return new Promise((resolve) => {
		let settled = false;
		const done = (value: string | undefined) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			unsub();
			resolve(value?.trim() || undefined);
		};
		const timer = setTimeout(() => done(undefined), timeoutMs);
		const unsub = events.on(`tasks:rpc:snapshot:reply:${requestId}`, (raw: unknown) => {
			const reply = raw as { success?: boolean; data?: { markdown?: string }; error?: string };
			done(reply.success ? reply.data?.markdown : undefined);
		});
		events.emit('tasks:rpc:snapshot', { requestId, consumer: 'live-compaction' });
	});
}

export function makeSummaryProgress(ctx: HookContext): SummaryProgress | undefined {
	if (!ctx.hasUI) return undefined;
	if (!ctx.ui.setStatus && !ctx.ui.setWidget && !ctx.ui.setWorkingMessage) return undefined;

	const ui = safeUI(ctx);
	const key = 'live-compaction';
	let lastUpdate = 0;
	let started = false;
	let tokensBefore = 0;

	const setCompactionWidget = (summary: string) => {
		ui.setWidget?.(
			key,
			() => {
				const component = new CompactionSummaryMessageComponent({
					role: 'compactionSummary',
					summary: summary.trimEnd() || '_Waiting for model output…_',
					tokensBefore,
					timestamp: Date.now(),
				});
				component.setExpanded(true);
				return component;
			},
			{ placement: 'aboveEditor' },
		);
	};

	const clear = () => {
		ui.setStatus?.(key, undefined);
		ui.setWidget?.(key, undefined);
		ui.setWorkingMessage?.();
	};

	return {
		start(modelLabel: string, compactedTokensBefore: number) {
			started = true;
			tokensBefore = compactedTokensBefore;
			ui.setStatus?.(key, `compacting with ${modelLabel}`);
			ui.setWorkingMessage?.(`Compacting with ${modelLabel}…`);
			setCompactionWidget('');
		},
		update(text: string) {
			if (!started) return;
			const now = Date.now();
			if (now - lastUpdate < 150) return;
			lastUpdate = now;
			const lineCount = text ? text.split('\n').length : 0;
			ui.setStatus?.(key, `compacting · ${lineCount} lines`);
			setCompactionWidget(text);
		},
		finish() {
			clear();
		},
		fail(message: string) {
			ui.setStatus?.(key, `compaction failed: ${message}`);
			ui.setWidget?.(key, [`Grounded compaction failed: ${message}`], {
				placement: 'aboveEditor',
			});
			ui.setWorkingMessage?.();
		},
	};
}
