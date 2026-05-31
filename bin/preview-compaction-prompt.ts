#!/usr/bin/env tsx
/**
 * Preview a rendered compaction prompt without invoking an LLM.
 *
 * Usage:
 *
 *   tsx bin/preview-compaction-prompt.ts \
 *     --template path/to/compaction-prompt.md \
 *     --fixture path/to/session.jsonl \
 *     [--cut-at <entry-id>] \
 *     [--previous-summary "old summary"] \
 *     [--focus "/compact instructions"] \
 *     [--no-files-touched]
 *
 * Prints the rendered prompt the LLM would have received, exactly. Returns
 * exit code 1 on any template/fixture error so it composes with CI.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";

import {
	convertToLlm,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";

import {
	collectFilesTouched,
	type FilesTouchedEntry,
} from "../extensions/_shared/files-touched-core";
import {
	collectDiscardedFromFixture,
	collectKeptTailFromFixture,
	loadSessionFixtureFromJsonl,
} from "../extensions/_shared/session-fixtures";
import { renderFilesTouchedManifestBlock } from "../extensions/_shared/files-touched-manifest";
import {
	buildRenderVars,
	loadCompactionTemplate,
} from "../extensions/live-compaction/template";

interface Args {
	template: string;
	fixture: string;
	cutAt?: string;
	previousSummary?: string;
	focus?: string;
	includeFilesTouched: boolean;
}

function parseArgs(argv: string[]): Args {
	let template: string | undefined;
	let fixture: string | undefined;
	let cutAt: string | undefined;
	let previousSummary: string | undefined;
	let focus: string | undefined;
	let includeFilesTouched = true;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case "--template":
				template = argv[++i];
				break;
			case "--fixture":
				fixture = argv[++i];
				break;
			case "--cut-at":
				cutAt = argv[++i];
				break;
			case "--previous-summary":
				previousSummary = argv[++i];
				break;
			case "--focus":
				focus = argv[++i];
				break;
			case "--no-files-touched":
				includeFilesTouched = false;
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!template || !fixture) {
		printHelp();
		throw new Error("--template and --fixture are required");
	}

	return {
		template: resolveCli(template),
		fixture: resolveCli(fixture),
		cutAt,
		previousSummary,
		focus,
		includeFilesTouched,
	};
}

function resolveCli(p: string): string {
	return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function printHelp(): void {
	process.stderr.write(
		`preview-compaction-prompt — render a compaction prompt without calling the LLM\n\n` +
			`Required:\n` +
			`  --template <path>          path to compaction-prompt.md template\n` +
			`  --fixture  <path>          path to session JSONL fixture\n\n` +
			`Optional:\n` +
			`  --cut-at <entry-id>        cut point (defaults to last user message)\n` +
			`  --previous-summary <text>  previous summary text for <previous-summary>\n` +
			`  --focus <text>             /compact instructions for <focus>\n` +
			`  --no-files-touched         omit the files-touched block\n`,
	);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const fixture = await loadSessionFixtureFromJsonl(args.fixture, {
		cutAtEntryId: args.cutAt,
		previousSummary: args.previousSummary,
	});

	const discardedMessages = collectDiscardedFromFixture(fixture);
	const keptTailMessages = collectKeptTailFromFixture(fixture);

	const discardedText = discardedMessages.length
		? serializeConversation(convertToLlm(discardedMessages))
		: "";
	const keptTailText = keptTailMessages.length
		? serializeConversation(convertToLlm(keptTailMessages))
		: "";

	let filesTouchedBlock: string | undefined;
	if (args.includeFilesTouched) {
		const entries: FilesTouchedEntry[] = collectFilesTouched(
			fixture.branchEntries as Parameters<typeof collectFilesTouched>[0],
			dirname(args.fixture),
		);
		const rendered = renderFilesTouchedManifestBlock(entries);
		filesTouchedBlock = rendered || undefined;
	}

	const template = await loadCompactionTemplate(args.template);
	if (!template) {
		throw new Error(`Template not found: ${args.template}`);
	}

	const vars = buildRenderVars({
		previousSummary: fixture.previousSummary,
		discardedText,
		keptTailText,
		filesTouchedBlock,
		focusText: args.focus,
		discardedMessages: convertToLlm(discardedMessages),
		keptTailMessages: convertToLlm(keptTailMessages),
		frontmatter: template.frontmatter,
	});

	process.stdout.write(template.render(vars));
	if (!process.stdout.write("\n")) {
		// drain
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`preview failed: ${message}\n`);
	process.exit(1);
});

void readFileSync; // silence unused-import lint when run via tsx
