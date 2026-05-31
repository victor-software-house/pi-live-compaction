/**
 * End-to-end snapshot test.
 *
 * Loads a realistic JSONL session fixture, exercises the same span
 * computation `runLiveCompaction` performs, then renders the template
 * and snapshots the rendered prompt. Catches any future drift in:
 *
 *   - frontmatter parsing
 *   - block ordering / partial composition
 *   - serialization of Pi messages to text
 *   - <files-touched> rendering
 *   - latest-user-ask helper
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { convertToLlm, serializeConversation } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import {
	collectFilesTouched,
	type FilesTouchedEntry,
} from '@live-compaction/files-touched';
import {
	collectDiscardedFromFixture,
	collectKeptTailFromFixture,
	loadSessionFixtureFromJsonl,
} from '@live-compaction/session-fixtures';
import { renderFilesTouchedManifestBlock } from '@live-compaction/files-touched-manifest';
import { buildRenderVars, loadCompactionTemplate } from '@live-compaction/template';

const FIXTURE = path.join(__dirname, 'fixtures', 'with-files-touched.jsonl');

async function setupTemplate(body: string): Promise<{
	templatePath: string;
	dir: string;
}> {
	const dir = await mkdtemp(path.join(tmpdir(), 'gc-snapshot-'));
	const templatePath = path.join(dir, 'compaction-prompt.md');
	await mkdir(path.join(dir, 'templates'), { recursive: true });
	await writeFile(
		path.join(dir, 'templates', '_blocks.md'),
		[
			'{% xml "previous-summary" %}{{ previous_summary }}{% endxml %}',
			'',
			'<discarded-conversation>',
			'{{ discarded | default: "(none)" }}',
			'</discarded-conversation>',
			'',
			'<kept-tail>',
			'{{ kept_tail | default: "(none)" }}',
			'</kept-tail>',
		].join('\n'),
		'utf8',
	);
	await writeFile(templatePath, body, 'utf8');
	return { templatePath, dir };
}

const LIQUID_TEMPLATE = [
	'---',
	'preset: deep',
	'---',
	"{% include '_blocks' %}",
	'{% xml "files-touched" %}{{ files_touched }}{% endxml %}',
	'{% if last_user_message | present %}',
	'<latest-user-ask>',
	'{{ last_user_message | truncate: 200 }}',
	'</latest-user-ask>',
	'{% endif %}',
].join('\n');

describe('compaction prompt snapshot from JSONL fixture', () => {
	it('renders a stable prompt from with-files-touched.jsonl', async () => {
		const fixture = await loadSessionFixtureFromJsonl(FIXTURE);
		const discardedMessages = collectDiscardedFromFixture(fixture);
		const keptTailMessages = collectKeptTailFromFixture(fixture);

		// The default cut-at heuristic is "last user message" → kept tail
		// must contain at least that user message.
		expect(keptTailMessages.length).toBeGreaterThan(0);
		expect(discardedMessages.length).toBeGreaterThan(0);

		const discardedText = serializeConversation(convertToLlm(discardedMessages));
		const keptTailText = serializeConversation(convertToLlm(keptTailMessages));

		const filesTouched: FilesTouchedEntry[] = collectFilesTouched(
			fixture.branchEntries as Parameters<typeof collectFilesTouched>[0],
			path.dirname(FIXTURE),
		);
		const filesTouchedBlock = renderFilesTouchedManifestBlock(filesTouched);
		// Files-touched bug regression: must not be a string of `undefined`.
		expect(filesTouchedBlock).not.toContain('undefined');

		const { templatePath } = await setupTemplate(LIQUID_TEMPLATE);
		const tpl = await loadCompactionTemplate(templatePath);
		expect(tpl).not.toBeNull();

		const vars = buildRenderVars({
			discardedText,
			keptTailText,
			filesTouchedBlock: filesTouchedBlock || undefined,
			discardedMessages: convertToLlm(discardedMessages),
			keptTailMessages: convertToLlm(keptTailMessages),
			frontmatter: tpl!.frontmatter,
		});

		const out = tpl!.render(vars);
		expect(out).not.toContain('undefined');
		// Latest user ask comes from the last user message in the fixture.
		expect(out).toContain('CHANGELOG.md');
		// Files-touched should reference at least README.md from the fixture.
		expect(out).toMatch(/README\.md/);
		expect(out).toMatchSnapshot();
	});
});
