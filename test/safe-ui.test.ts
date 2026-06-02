import type { HookContext } from '@live-compaction/types';
import { safeUI } from '@live-compaction/types';
import { describe, expect, it, vi } from 'vitest';

function makeMockCtx(overrides?: Partial<HookContext['ui']>): HookContext {
	return {
		hasUI: true,
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
			setWorkingMessage: vi.fn(),
			...overrides,
		},
		modelRegistry: {
			getAll: () => [],
			getApiKeyAndHeaders: async () => ({ ok: true as const }),
		},
	};
}

describe('safeUI', () => {
	it('delegates to underlying ctx.ui when ctx is valid', () => {
		const ctx = makeMockCtx();
		const ui = safeUI(ctx);

		ui.notify('hello', 'info');
		ui.setStatus('key', 'text');
		ui.setWidget('key', ['line']);
		ui.setWorkingMessage('working');

		expect(ctx.ui.notify).toHaveBeenCalledWith('hello', 'info');
		expect(ctx.ui.setStatus).toHaveBeenCalledWith('key', 'text');
		expect(ctx.ui.setWidget).toHaveBeenCalledWith('key', ['line']);
		expect(ctx.ui.setWorkingMessage).toHaveBeenCalledWith('working');
	});

	it('swallows errors when ctx goes stale', () => {
		const staleError = new Error(
			'This extension ctx is stale after session replacement or reload.',
		);
		const ctx = makeMockCtx({
			notify: vi.fn(() => {
				throw staleError;
			}),
			setStatus: vi.fn(() => {
				throw staleError;
			}),
			setWidget: vi.fn(() => {
				throw staleError;
			}),
			setWorkingMessage: vi.fn(() => {
				throw staleError;
			}),
		});
		const ui = safeUI(ctx);

		// Should not throw
		expect(() => ui.notify('hello', 'info')).not.toThrow();
		expect(() => ui.setStatus('key', 'text')).not.toThrow();
		expect(() => ui.setWidget('key', ['line'])).not.toThrow();
		expect(() => ui.setWorkingMessage('working')).not.toThrow();
	});

	it('returns undefined from wrapped calls when ctx throws', () => {
		const ctx = makeMockCtx({
			setStatus: vi.fn(() => {
				throw new Error('stale');
			}),
		});
		const ui = safeUI(ctx);

		// Wrapped call returns undefined instead of throwing
		expect(ui.setStatus('key', 'text')).toBeUndefined();
	});
});
