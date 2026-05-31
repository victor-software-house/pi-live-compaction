/**
 * Session fixture loader for live-compaction tests and previews.
 *
 * Reads a Pi session JSONL file, classifies entries the way pi's
 * compaction prep does, and returns a synthetic `BeforeCompactPreparation`
 * shape ready to feed into the template render pipeline.
 *
 * This intentionally re-implements the minimum subset of pi's session loader
 * — we only need the fields `runLiveCompaction` consumes:
 *   - `branchEntries` for files-touched + kept-tail collection
 *   - `messagesToSummarize` for the discarded span
 *   - `turnPrefixMessages` for split-turn prefixes
 *   - `firstKeptEntryId` boundary
 *
 * Two fixture flavors are supported:
 *
 *   1. `loadSessionFixtureFromJsonl`   — give it a real session JSONL plus a
 *      "cut at message id" point, and it computes discarded vs kept-tail
 *      spans automatically.
 *   2. `buildSessionFixture`           — programmatic builder for unit tests
 *      that don't need a JSONL on disk.
 */

import { readFile } from 'node:fs/promises';

import type { Message } from '@earendil-works/pi-ai';

// ---------------------------------------------------------------------------
// Types mirroring the relevant slice of pi's runtime
// ---------------------------------------------------------------------------

/** Pi session JSONL entry, narrowed to the parts we use. */
export interface SessionMessageEntry {
	id: string;
	type: 'message';
	message: Message;
	timestamp?: string;
}

export interface SessionOtherEntry {
	id: string;
	type: string;
	[k: string]: unknown;
}

export type SessionEntry = SessionMessageEntry | SessionOtherEntry;

export interface SessionFixture {
	/** All entries on the active branch, chronological order. */
	branchEntries: SessionEntry[];
	/** Discarded span: replaced by the new summary. */
	messagesToSummarize: Message[];
	/** Split-turn prefix discarded with the head. */
	turnPrefixMessages: Message[];
	/** Boundary entry id — the first entry that survives compaction. */
	firstKeptEntryId?: string;
	/** Optional previous summary text from an earlier compaction. */
	previousSummary?: string;
}

// ---------------------------------------------------------------------------
// JSONL loading
// ---------------------------------------------------------------------------

export async function loadSessionEntries(jsonlPath: string): Promise<SessionEntry[]> {
	const raw = await readFile(jsonlPath, 'utf8');
	const entries: SessionEntry[] = [];
	let lineNo = 0;
	for (const line of raw.split(/\r?\n/)) {
		lineNo++;
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line) as SessionEntry);
		} catch {
			// Pi sometimes appends partial lines during a crash; skip silently.
			// Tests should fail loudly only if the cut point fails to resolve.
		}
	}
	void lineNo;
	return entries;
}

export interface FixtureFromJsonlOptions {
	/**
	 * Entry id to cut at. Everything before this id (exclusive) becomes the
	 * discarded span; everything from this id onward becomes the kept tail.
	 * If omitted, defaults to "cut at the last user message" so the fixture
	 * always has something on each side.
	 */
	cutAtEntryId?: string;
	/**
	 * Optional pre-existing summary text for `<previous-summary>`.
	 */
	previousSummary?: string;
}

/**
 * Build a fixture from an on-disk JSONL session file. The returned shape is
 * directly consumable by both the preview CLI and the render tests.
 */
export async function loadSessionFixtureFromJsonl(
	jsonlPath: string,
	options: FixtureFromJsonlOptions = {},
): Promise<SessionFixture> {
	const entries = await loadSessionEntries(jsonlPath);
	if (entries.length === 0) {
		throw new Error(`Session fixture has no entries: ${jsonlPath}`);
	}

	const cutId = options.cutAtEntryId ?? findDefaultCutId(entries);
	if (!cutId) {
		throw new Error(
			`Could not resolve a default cut point for ${jsonlPath} (no user messages found)`,
		);
	}

	const cutIndex = entries.findIndex((e) => e.id === cutId);
	if (cutIndex < 0) {
		throw new Error(`Cut entry id ${cutId} not found in session ${jsonlPath}`);
	}

	const discardedMessages: Message[] = [];
	for (let i = 0; i < cutIndex; i++) {
		const entry = entries[i];
		if (entry.type === 'message') {
			discardedMessages.push((entry as SessionMessageEntry).message);
		}
	}

	return {
		branchEntries: entries,
		messagesToSummarize: discardedMessages,
		turnPrefixMessages: [],
		firstKeptEntryId: cutId,
		previousSummary: options.previousSummary,
	};
}

function findDefaultCutId(entries: SessionEntry[]): string | undefined {
	// Cut at the most recent user message so kept-tail always has at least
	// the latest user ask plus whatever comes after it.
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === 'message' && (entry as SessionMessageEntry).message.role === 'user') {
			return entry.id;
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Programmatic builder for unit tests
// ---------------------------------------------------------------------------

export interface BuildFixtureInput {
	discarded: Message[];
	keptTail: Message[];
	turnPrefix?: Message[];
	previousSummary?: string;
}

export function buildSessionFixture(input: BuildFixtureInput): SessionFixture {
	const branchEntries: SessionEntry[] = [];
	let i = 0;
	for (const m of input.discarded) {
		branchEntries.push({
			id: `discarded-${i++}`,
			type: 'message',
			message: m,
		} satisfies SessionMessageEntry);
	}
	const firstKeptId = input.keptTail.length ? `kept-0` : undefined;
	let j = 0;
	for (const m of input.keptTail) {
		branchEntries.push({
			id: `kept-${j++}`,
			type: 'message',
			message: m,
		} satisfies SessionMessageEntry);
	}
	return {
		branchEntries,
		messagesToSummarize: input.discarded,
		turnPrefixMessages: input.turnPrefix ?? [],
		firstKeptEntryId: firstKeptId,
		previousSummary: input.previousSummary,
	};
}

// ---------------------------------------------------------------------------
// Helpers used by tests/preview to extract the kept-tail span exactly the
// way runLiveCompaction does.
// ---------------------------------------------------------------------------

export function collectKeptTailFromFixture(fixture: SessionFixture): Message[] {
	if (!fixture.firstKeptEntryId) return [];
	const startIndex = fixture.branchEntries.findIndex((e) => e.id === fixture.firstKeptEntryId);
	if (startIndex < 0) return [];
	const out: Message[] = [];
	for (let i = startIndex; i < fixture.branchEntries.length; i++) {
		const entry = fixture.branchEntries[i];
		if (entry.type === 'message') {
			out.push((entry as SessionMessageEntry).message);
		}
	}
	return out;
}

/** Concatenated discarded messages in chronological order (head + prefix). */
export function collectDiscardedFromFixture(fixture: SessionFixture): Message[] {
	return [...fixture.messagesToSummarize, ...fixture.turnPrefixMessages];
}
