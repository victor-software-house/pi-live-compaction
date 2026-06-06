import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { registerCompactionChatMessage } from '@live-compaction/compaction/chat-message';
import { describe, expect, it, vi } from 'vitest';

function serialize(entries: readonly unknown[]): string {
	return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

describe('registerCompactionChatMessage session finalization', () => {
	it('persists stream messages hidden before compaction rebuilds chat', () => {
		const handlers = new Map<string, (event: unknown, ctx: never) => void>();
		const pi = {
			registerMessageRenderer: vi.fn(),
			on: vi.fn((event: string, handler: (event: unknown, ctx: never) => void) => {
				handlers.set(event, handler);
			}),
		} as never;
		registerCompactionChatMessage(pi);

		const dir = mkdtempSync(path.join(tmpdir(), 'live-compaction-session-'));
		try {
			const sessionFile = path.join(dir, 'session.jsonl');
			const header = {
				type: 'session',
				version: 3,
				id: 'session-id',
				timestamp: '2026-06-06T00:00:00.000Z',
				cwd: dir,
			};
			const streamEntry = {
				type: 'custom_message',
				customType: 'live-compaction-stream',
				content: '_Waiting for model output…_',
				display: true,
				id: 'stream01',
				parentId: null,
				timestamp: '2026-06-06T00:00:01.000Z',
			};
			const compactionEntry = {
				type: 'compaction',
				id: 'compact1',
				parentId: 'stream01',
				timestamp: '2026-06-06T00:00:02.000Z',
				summary: 'summary',
				firstKeptEntryId: 'stream01',
				tokensBefore: 100,
				fromHook: true,
			};
			const entries = [streamEntry, compactionEntry];
			writeFileSync(sessionFile, serialize([header, ...entries]), 'utf8');

			const notify = vi.fn();
			const handler = handlers.get('session_compact');
			expect(handler).toBeDefined();
			handler?.({ type: 'session_compact', compactionEntry, fromExtension: true }, {
				hasUI: true,
				ui: {
					notify,
					setStatus: vi.fn(),
					setWidget: vi.fn(),
					setWorkingMessage: vi.fn(),
				},
				sessionManager: {
					getSessionFile: () => sessionFile,
					getHeader: () => header,
					getEntries: () => entries,
				},
				modelRegistry: {
					getAll: () => [],
					getApiKeyAndHeaders: async () => ({ ok: true as const }),
				},
			} as never);

			expect(streamEntry.display).toBe(false);
			expect(readFileSync(sessionFile, 'utf8')).toBe(serialize([header, ...entries]));
			expect(notify).toHaveBeenCalledWith(
				'Live compaction stream finalized: 1 transient message hidden from resume.',
				'info',
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('leaves the original JSONL and in-memory entry intact when state mismatches disk', () => {
		const handlers = new Map<string, (event: unknown, ctx: never) => void>();
		const pi = {
			registerMessageRenderer: vi.fn(),
			on: vi.fn((event: string, handler: (event: unknown, ctx: never) => void) => {
				handlers.set(event, handler);
			}),
		} as never;
		registerCompactionChatMessage(pi);

		const dir = mkdtempSync(path.join(tmpdir(), 'live-compaction-session-'));
		try {
			const sessionFile = path.join(dir, 'session.jsonl');
			const header = {
				type: 'session',
				version: 3,
				id: 'session-id',
				timestamp: '2026-06-06T00:00:00.000Z',
				cwd: dir,
			};
			const streamEntry = {
				type: 'custom_message',
				customType: 'live-compaction-stream',
				content: '_Waiting for model output…_',
				display: true,
				id: 'stream01',
				parentId: null,
				timestamp: '2026-06-06T00:00:01.000Z',
			};
			const compactionEntry = {
				type: 'compaction',
				id: 'compact1',
				parentId: 'stream01',
				timestamp: '2026-06-06T00:00:02.000Z',
				summary: 'summary',
				firstKeptEntryId: 'stream01',
				tokensBefore: 100,
				fromHook: true,
			};
			const entries = [streamEntry, compactionEntry];
			const originalContent = `${serialize([header, ...entries]).trimEnd()}\n{"type":"custom","id":"extra","parentId":"compact1","timestamp":"2026-06-06T00:00:03.000Z","customType":"other"}\n`;
			writeFileSync(sessionFile, originalContent, 'utf8');

			const notify = vi.fn();
			const handler = handlers.get('session_compact');
			expect(handler).toBeDefined();
			handler?.({ type: 'session_compact', compactionEntry, fromExtension: true }, {
				hasUI: true,
				ui: {
					notify,
					setStatus: vi.fn(),
					setWidget: vi.fn(),
					setWorkingMessage: vi.fn(),
				},
				sessionManager: {
					getSessionFile: () => sessionFile,
					getHeader: () => header,
					getEntries: () => entries,
				},
				modelRegistry: {
					getAll: () => [],
					getApiKeyAndHeaders: async () => ({ ok: true as const }),
				},
			} as never);

			expect(streamEntry.display).toBe(true);
			expect(readFileSync(sessionFile, 'utf8')).toBe(originalContent);
			expect(notify).toHaveBeenCalledWith(
				'Live compaction stream finalization failed; original session JSONL restored: Live session entries do not match the persisted session file',
				'error',
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
