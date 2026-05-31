/**
 * Declarative example runner.
 *
 * One folder per example under `examples/`. Each folder contains:
 *
 *   case.json                 input data (see ExampleCase below)
 *   compaction-prompt.md      Liquid template with optional frontmatter knobs
 *   templates/*               optional partials
 *   expected.md               golden output
 *
 * The runner:
 *
 *   1. parses case.json into discarded/kept-tail Message[]
 *   2. serializes them the same way runLiveCompaction does
 *   3. renders the template against the deterministic RenderVars
 *   4. asserts strict equality with expected.md
 *
 * To regenerate every expected.md after an intentional template change:
 *
 *     UPDATE_EXAMPLES=1 pnpm test
 *
 * The runner also exposes `renderExample` so the regen script (and ad-hoc
 * inspection) can use the exact same rendering path.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Message } from '@earendil-works/pi-ai';
import { convertToLlm, serializeConversation } from '@earendil-works/pi-coding-agent';

import type { FilesTouchedEntry } from '@live-compaction/files-touched';
import { renderFilesTouchedManifestBlock } from '@live-compaction/files-touched-manifest';
import { buildRenderVars, loadCompactionTemplate } from '@live-compaction/template';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface ExampleCase {
	/** Free-form description, surfaced as the test name. */
	description: string;
	/** Optional previous-summary text (populates <previous-summary>). */
	previous_summary?: string;
	/** Optional /compact focus text (populates <focus>). */
	focus?: string;
	/**
	 * Files-touched entries for the rendered <files-touched> block. Use the
	 * compact `[ops, displayPath]` shape for readability — `R`, `W`, `E`,
	 * `M`, `D` map to read/write/edit/move/delete operations.
	 */
	files_touched?: ExampleFileTouched[];
	/**
	 * Whether the runner should populate the files-touched block. Defaults
	 * to true when `files_touched` is non-empty, false otherwise. Use this
	 * to assert the "block omitted entirely" path with empty arrays.
	 */
	include_files_touched?: boolean;
	/**
	 * Discarded messages (the span being summarised). Each entry is either a
	 * shorthand `{ role, text }` or a full `{ role, content: [...] }` for
	 * tool calls and tool results.
	 */
	discarded: ExampleMessage[];
	/**
	 * Kept-tail messages (raw context that survives compaction). Should
	 * contain the latest user ask so `<latest-user-ask>` is anchored.
	 */
	kept_tail: ExampleMessage[];
}

export type ExampleMessage =
	| { role: 'user' | 'assistant'; text: string }
	| { role: 'user' | 'assistant' | 'toolResult'; content: ContentBlock[] };

type ContentBlock =
	| { type: 'text'; text: string }
	| {
			type: 'toolCall';
			id: string;
			name: string;
			arguments: Record<string, unknown>;
	  }
	| { type: 'toolResult'; toolCallId: string; output: string };

export interface ExampleFileTouched {
	/** Operations badge: any subset of "RWEMD" (case insensitive). */
	ops: string;
	displayPath: string;
	/** Optional explicit absolute path; defaults to /abs/<displayPath>. */
	path?: string;
}

// ---------------------------------------------------------------------------
// Loading + rendering
// ---------------------------------------------------------------------------

export interface ExampleDir {
	name: string;
	dir: string;
	templatePath: string;
	casePath: string;
	expectedPath: string;
}

export async function discoverExamples(examplesRoot: string): Promise<ExampleDir[]> {
	let entries: string[];
	try {
		entries = await readdir(examplesRoot);
	} catch {
		return [];
	}
	const out: ExampleDir[] = [];
	for (const entry of entries.sort()) {
		if (entry.startsWith('.') || entry.startsWith('_')) continue;
		const dir = path.join(examplesRoot, entry);
		const templatePath = path.join(dir, 'compaction-prompt.md');
		const casePath = path.join(dir, 'case.json');
		const expectedPath = path.join(dir, 'expected.md');
		try {
			await readFile(templatePath, 'utf8');
			await readFile(casePath, 'utf8');
		} catch {
			continue; // not a complete example
		}
		out.push({ name: entry, dir, templatePath, casePath, expectedPath });
	}
	return out;
}

export async function loadCase(casePath: string): Promise<ExampleCase> {
	const raw = await readFile(casePath, 'utf8');
	return JSON.parse(raw) as ExampleCase;
}

export async function renderExample(example: ExampleDir): Promise<string> {
	const exampleCase = await loadCase(example.casePath);

	const discardedMessages = exampleCase.discarded.map(toMessage);
	const keptTailMessages = exampleCase.kept_tail.map(toMessage);

	const discardedText =
		discardedMessages.length > 0 ? serializeConversation(convertToLlm(discardedMessages)) : '';
	const keptTailText =
		keptTailMessages.length > 0 ? serializeConversation(convertToLlm(keptTailMessages)) : '';

	const includeFilesTouched =
		exampleCase.include_files_touched ??
		Boolean(exampleCase.files_touched && exampleCase.files_touched.length > 0);
	let filesTouchedBlock: string | undefined;
	if (includeFilesTouched && exampleCase.files_touched && exampleCase.files_touched.length > 0) {
		const entries = exampleCase.files_touched.map(toFilesTouchedEntry);
		const rendered = renderFilesTouchedManifestBlock(entries);
		filesTouchedBlock = rendered || undefined;
	}

	const template = await loadCompactionTemplate(example.templatePath);
	if (!template) {
		throw new Error(`Template not found: ${example.templatePath}`);
	}

	const vars = buildRenderVars({
		previousSummary: exampleCase.previous_summary,
		discardedText,
		keptTailText,
		filesTouchedBlock,
		focusText: exampleCase.focus,
		discardedMessages: convertToLlm(discardedMessages),
		keptTailMessages: convertToLlm(keptTailMessages),
		frontmatter: template.frontmatter,
	});

	return template.render(vars);
}

export async function readExpected(example: ExampleDir): Promise<string | null> {
	try {
		return await readFile(example.expectedPath, 'utf8');
	} catch {
		return null;
	}
}

export async function writeExpected(example: ExampleDir, rendered: string): Promise<void> {
	await writeFile(example.expectedPath, rendered, 'utf8');
}

export function shouldUpdate(): boolean {
	return process.env.UPDATE_EXAMPLES === '1';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMessage(input: ExampleMessage): Message {
	if ('text' in input) {
		return {
			role: input.role,
			content: [{ type: 'text', text: input.text }],
			timestamp: 0,
		} as Message;
	}
	return {
		role: input.role,
		content: input.content,
		timestamp: 0,
	} as Message;
}

function toFilesTouchedEntry(entry: ExampleFileTouched): FilesTouchedEntry {
	const ops = new Set<'read' | 'write' | 'edit' | 'move' | 'delete'>();
	const upper = entry.ops.toUpperCase();
	if (upper.includes('R')) ops.add('read');
	if (upper.includes('W')) ops.add('write');
	if (upper.includes('E')) ops.add('edit');
	if (upper.includes('M')) ops.add('move');
	if (upper.includes('D')) ops.add('delete');
	return {
		path: entry.path ?? `/abs/${entry.displayPath}`,
		displayPath: entry.displayPath,
		operations: ops,
		lastTimestamp: 0,
	};
}
