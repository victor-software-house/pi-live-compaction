#!/usr/bin/env tsx
/**
 * Regenerate every example's expected.md from its current case.json + template.
 *
 * Use after an intentional change to the template engine, helpers, or default
 * partials. Equivalent to `UPDATE_EXAMPLES=1 pnpm test`, but without the
 * vitest noise — useful when adding or editing examples by hand.
 *
 * Usage:
 *   tsx bin/update-examples.ts            update every example
 *   tsx bin/update-examples.ts <name>...  update only the named subset
 */

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
	discoverExamples,
	loadCase,
	renderExample,
	writeExpected,
} from "../test/example-runner";

async function main(): Promise<void> {
	const examplesRoot = path.join(__dirname, "..", "examples");
	const filter = new Set(process.argv.slice(2));
	const examples = await discoverExamples(examplesRoot);
	if (examples.length === 0) {
		process.stderr.write(`No examples found in ${examplesRoot}\n`);
		process.exit(1);
	}

	let updated = 0;
	for (const example of examples) {
		if (filter.size > 0 && !filter.has(example.name)) continue;
		const exampleCase = await loadCase(example.casePath);
		const rendered = await renderExample(example);
		await writeExpected(example, rendered);
		updated++;
		process.stdout.write(`updated ${example.name}: ${exampleCase.description}\n`);
	}

	if (filter.size > 0 && updated === 0) {
		process.stderr.write(`No examples matched filter: ${[...filter].join(", ")}\n`);
		process.exit(1);
	}
	process.stdout.write(`\nUpdated ${updated} example(s).\n`);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`update-examples failed: ${message}\n`);
	process.exit(1);
});
