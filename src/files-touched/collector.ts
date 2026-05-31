import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import { firstDefinedString, getTrackedToolActions } from '@live-compaction/files-touched/parsers';
import {
	buildRootMappings,
	displayPathForTrackedPath,
	normalizeTrackedPath,
	resolveCanonicalPath,
	resolveMoveRedirect,
} from '@live-compaction/files-touched/paths';
import type { FilesTouchedEntry, FileTouchOperation } from '@live-compaction/files-touched/types';

type FileMove = { from: string; to: string };

type TrackedTouchRecord = {
	path: string;
	operation: FileTouchOperation;
	timestamp: number;
};

function extractTextFromContent(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((block) => {
			if (!block || typeof block !== 'object') return '';
			return typeof (block as { text?: unknown }).text === 'string'
				? (block as { text: string }).text
				: '';
		})
		.filter(Boolean)
		.join('\n');
}

function getToolCallId(value: unknown): string | null {
	if (!value || typeof value !== 'object') return null;
	return firstDefinedString(
		(value as { id?: unknown }).id,
		(value as { toolCallId?: unknown }).toolCallId,
		(value as { tool_call_id?: unknown }).tool_call_id,
		(value as { tool_use_id?: unknown }).tool_use_id,
	);
}

export function collectFilesTouched(
	entries: SessionEntry[],
	cwd?: string | null,
): FilesTouchedEntry[] {
	// --- Pass 1: collect tool call intentions ---
	const toolCalls = new Map<string, ReturnType<typeof getTrackedToolActions>>();

	for (const entry of entries) {
		if (entry.type !== 'message') continue;
		const msg = entry.message;
		if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
		for (const block of msg.content) {
			if (
				!block ||
				typeof block !== 'object' ||
				(block as { type?: unknown }).type !== 'toolCall'
			) {
				continue;
			}
			const toolCallId = getToolCallId(block);
			const toolName =
				typeof (block as { name?: unknown }).name === 'string'
					? (block as { name: string }).name
					: '';
			const args = (block as { arguments?: unknown }).arguments;
			const argObject =
				args && typeof args === 'object' && !Array.isArray(args)
					? (args as Record<string, unknown>)
					: {};
			if (!toolCallId || !toolName) continue;
			const actions = getTrackedToolActions(toolName, argObject);
			if (actions.length > 0) toolCalls.set(toolCallId, actions);
		}
	}

	// --- Pass 2: confirm via tool results ---
	const touches: TrackedTouchRecord[] = [];
	const moves: FileMove[] = [];

	for (const entry of entries) {
		if (entry.type !== 'message') continue;
		const msg = entry.message;
		if (msg.role !== 'toolResult' || msg.isError) continue;

		const toolCallId = firstDefinedString(
			msg.toolCallId,
			(msg as { tool_call_id?: unknown }).tool_call_id,
			(msg as { tool_use_id?: unknown }).tool_use_id,
		);
		if (!toolCallId) continue;

		const actions = toolCalls.get(toolCallId);
		if (!actions || actions.length === 0) continue;

		const toolResultText = extractTextFromContent(msg.content);
		const isNoOpEdit = /applied:\s*0|no changes applied|nothing to (?:do|change)/i.test(
			toolResultText,
		);
		for (const action of actions) {
			if (action.kind === 'move') {
				moves.push({ from: action.from, to: action.to });
				touches.push({ path: action.to, operation: 'move', timestamp: msg.timestamp });
				continue;
			}
			if (isNoOpEdit && action.operation === 'edit') continue;
			touches.push({ path: action.path, operation: action.operation, timestamp: msg.timestamp });
		}
	}

	// --- Build root mappings ---
	const rootMappings = buildRootMappings(
		[...touches.map((t) => t.path), ...moves.flatMap((m) => [m.from, m.to])],
		cwd,
	);

	// --- Build move redirects ---
	const redirects = new Map<string, string>();
	for (const move of moves) {
		const fromPath = normalizeTrackedPath(move.from, rootMappings, cwd);
		const toPath = normalizeTrackedPath(move.to, rootMappings, cwd);
		if (fromPath && toPath && fromPath !== toPath) redirects.set(fromPath, toPath);
	}

	// --- Merge into canonical paths ---
	const merged = new Map<string, { operations: Set<FileTouchOperation>; lastTimestamp: number }>();
	for (const touch of touches) {
		const normalizedPath = normalizeTrackedPath(touch.path, rootMappings, cwd);
		const canonicalPath = resolveMoveRedirect(normalizedPath, redirects);
		if (!canonicalPath) continue;
		const existing = merged.get(canonicalPath);
		if (existing) {
			existing.operations.add(touch.operation);
			if (touch.timestamp > existing.lastTimestamp) existing.lastTimestamp = touch.timestamp;
			continue;
		}
		merged.set(canonicalPath, {
			operations: new Set([touch.operation]),
			lastTimestamp: touch.timestamp,
		});
	}

	// --- Resolve display paths ---
	const prepared = [...merged.entries()]
		.map(([canonicalPath, value]) => {
			const resolvedPath = resolveCanonicalPath(canonicalPath, rootMappings, cwd);
			return {
				canonicalPath,
				path: resolvedPath,
				displayPath: displayPathForTrackedPath(canonicalPath, resolvedPath, cwd),
				operations: value.operations,
				lastTimestamp: value.lastTimestamp,
			};
		})
		.sort((left, right) => right.lastTimestamp - left.lastTimestamp);

	const displayCounts = new Map<string, number>();
	for (const file of prepared) {
		displayCounts.set(file.displayPath, (displayCounts.get(file.displayPath) ?? 0) + 1);
	}

	return prepared.map((file) => ({
		path: file.path,
		displayPath: (displayCounts.get(file.displayPath) ?? 0) > 1 ? file.path : file.displayPath,
		operations: file.operations,
		lastTimestamp: file.lastTimestamp,
	}));
}
