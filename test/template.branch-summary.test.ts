/**
 * On-disk branch-summary template loaded through `loadCompactionTemplate`.
 *
 * Same engine as compaction templates — the only difference is which
 * variable bag the caller supplies. This test verifies that custom
 * branch-summary templates can use partials, the {% xml %} tag, and the
 * branch-summary-specific variables (branch_messages, custom_focus, etc.).
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBranchSummaryRenderVars, loadCompactionTemplate } from '@live-compaction/template';
import { describe, expect, it } from 'vitest';

describe('branch-summary template (custom on-disk)', () => {
	it('loads, parses, and renders against branch-summary render vars', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'gc-branch-'));
		await mkdir(path.join(dir, 'templates'), { recursive: true });
		await writeFile(
			path.join(dir, 'templates', '_block.md'),
			[
				'{% xml "branch-messages" %}{{ branch_messages }}{% endxml %}',
				'',
				'{% xml "files-touched" %}{{ files_touched }}{% endxml %}',
				'',
				'{% xml "focus" %}{{ custom_focus }}{% endxml %}',
			].join('\n'),
			'utf8',
		);
		const templatePath = path.join(dir, 'branch-summary-prompt.md');
		await writeFile(
			templatePath,
			[
				'---',
				'description: Branch summary prompt.',
				'---',
				"{% include '_block' %}",
				'',
				'## stats',
				'messages: {{ stats.branch_messages }}',
				'chars:    {{ stats.branch_chars }}',
			].join('\n'),
			'utf8',
		);

		const tpl = await loadCompactionTemplate(templatePath);
		expect(tpl).not.toBeNull();
		expect(tpl?.frontmatter.description).toBe('Branch summary prompt.');

		const vars = buildBranchSummaryRenderVars({
			branchMessagesText: '[User]: investigate approach B',
			filesTouchedBlock: 'R  spike.md',
			customFocus: '/tree --focus rate-limiter',
			branchEntryMessages: [
				{
					role: 'user',
					content: [{ type: 'text', text: 'investigate approach B' }],
				} as never,
			],
		});

		const out = tpl?.render(vars as unknown as Record<string, unknown>);

		expect(out).toContain('<branch-messages>');
		expect(out).toContain('[User]: investigate approach B');
		expect(out).toContain('<files-touched>');
		expect(out).toContain('R  spike.md');
		expect(out).toContain('<focus>');
		expect(out).toContain('/tree --focus rate-limiter');
		expect(out).toContain('messages: 1');
		expect(out).toContain('chars:    30'); // 30 chars in branchMessagesText
		expect(out).not.toContain('undefined');
	});

	it('custom_focus is omitted entirely when missing', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'gc-branch-no-focus-'));
		const templatePath = path.join(dir, 'branch-summary-prompt.md');
		await writeFile(templatePath, '{% xml "focus" %}{{ custom_focus }}{% endxml %}', 'utf8');

		const tpl = await loadCompactionTemplate(templatePath);
		const vars = buildBranchSummaryRenderVars({
			branchEntryMessages: [],
		});
		const out = tpl?.render(vars as unknown as Record<string, unknown>).trim();

		// {% xml %} swallows empty bodies
		expect(out).toBe('');
	});
});
