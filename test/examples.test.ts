/**
 * Auto-discovers every `examples/<name>/` directory and asserts that the
 * rendered output matches `expected.md` byte for byte.
 *
 * Regenerate all expected outputs after an intentional template change:
 *
 *   UPDATE_EXAMPLES=1 pnpm test
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
	discoverExamples,
	loadCase,
	readExpected,
	renderExample,
	shouldUpdate,
	writeExpected,
} from '@test/example-runner';

const EXAMPLES_ROOT = path.join(__dirname, '..', 'examples');

const examples = await discoverExamples(EXAMPLES_ROOT);

describe('examples (declarative cases)', () => {
	if (examples.length === 0) {
		it.skip('no examples discovered', () => {
			/* placeholder */
		});
		return;
	}

	for (const example of examples) {
		it(`${example.name} renders identical to expected.md`, async () => {
			const exampleCase = await loadCase(example.casePath);
			const rendered = await renderExample(example);

			if (shouldUpdate()) {
				await writeExpected(example, rendered);
			}

			const expected = await readExpected(example);
			expect(
				expected,
				`Missing expected.md for example "${example.name}". Run UPDATE_EXAMPLES=1 pnpm test to generate it. Description: ${exampleCase.description}`,
			).not.toBeNull();

			expect(rendered).toBe(expected);
		});
	}
});
