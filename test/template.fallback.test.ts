/**
 * Built-in fallback templates.
 *
 * Two templates ship inline in config.ts (DEFAULT_COMPACTION_TEMPLATE_BODY,
 * DEFAULT_BRANCH_SUMMARY_TEMPLATE_BODY) so a user with no on-disk template
 * still gets a complete, structured prompt. Both compile through
 * `loadCompactionTemplateFromString` and render through the same liquid
 * engine as on-disk templates.
 */

import { describe, expect, it } from 'vitest';

import {
	DEFAULT_BRANCH_SUMMARY_TEMPLATE_BODY,
	DEFAULT_COMPACTION_TEMPLATE_BODY,
} from '@live-compaction/config';
import {
	buildBranchSummaryRenderVars,
	buildRenderVars,
	loadCompactionTemplateFromString,
} from '@live-compaction/template';

describe('DEFAULT_COMPACTION_TEMPLATE_BODY', () => {
	const tpl = loadCompactionTemplateFromString(DEFAULT_COMPACTION_TEMPLATE_BODY, {
		templatePath: '<built-in compaction template>',
		templateDir: '/',
	});

	it('renders every block when all variables are populated', () => {
		const out = tpl.render(
			buildRenderVars({
				previousSummary: 'old durable state.',
				discardedText: '[User]: hello',
				keptTailText: '[User]: now do X',
				filesTouchedBlock: '## Files touched\n\n```text\nR  README.md\n```',
				focusText: '/compact --preset deep',
				discardedMessages: [],
				keptTailMessages: [
					{
						role: 'user',
						content: [{ type: 'text', text: 'now do X' }],
					} as never,
				],
			}),
		);

		expect(out).toContain('<previous-summary>');
		expect(out).toContain('old durable state.');
		expect(out).toContain('<discarded-conversation>');
		expect(out).toContain('[User]: hello');
		expect(out).toContain('<kept-tail>');
		expect(out).toContain('[User]: now do X');
		expect(out).toContain('<files-touched>');
		expect(out).toContain('R  README.md');
		expect(out).toContain('<focus>');
		expect(out).toContain('/compact --preset deep');
		expect(out).toContain('<latest-user-ask>');
		expect(out).toContain('now do X');
		// Contract sentinels
		expect(out).toContain('# What to include');
		expect(out).toContain('## Brief');
		expect(out).toContain('## Status');
		expect(out).not.toContain('Transient-input carry-forward');
		expect(out).not.toContain('Never write placeholder references');
		expect(out).not.toContain('The continuation model will not see them');
		expect(out).not.toContain('per `<focus>`');
		// Never `undefined`-leaks anywhere
		expect(out).not.toContain('undefined');
	});

	it('omits optional blocks when their variables are absent', () => {
		const out = tpl.render(
			buildRenderVars({
				discardedText: '[User]: hi',
				keptTailText: '',
				discardedMessages: [],
				keptTailMessages: [],
			}),
		);

		// The contract section mentions block names as <code>; the actual
		// rendered blocks (their literal `<tag>\n...\n</tag>` shape) must
		// not appear when their data is absent.
		expect(out).not.toMatch(/<previous-summary>\n[^<]/);
		expect(out).not.toMatch(/<files-touched>\n[^<]/);
		expect(out).not.toMatch(/<focus>\n[^<]/);
		expect(out).not.toMatch(/<latest-user-ask>\n[^<]/);
		expect(out).toContain('<discarded-conversation>');
		expect(out).toContain('(none)'); // empty kept tail prints "(none)"
		// Contract still rendered
		expect(out).toContain('# What to include');
	});

	it('falls back to (none) when both spans are empty', () => {
		const out = tpl.render(
			buildRenderVars({
				discardedText: '',
				keptTailText: '',
				discardedMessages: [],
				keptTailMessages: [],
			}),
		);
		expect(out).toContain('<discarded-conversation>\n(none)\n</discarded-conversation>');
		expect(out).toContain('<kept-tail>\n(none)\n</kept-tail>');
	});
});

describe('DEFAULT_BRANCH_SUMMARY_TEMPLATE_BODY', () => {
	const tpl = loadCompactionTemplateFromString(DEFAULT_BRANCH_SUMMARY_TEMPLATE_BODY, {
		templatePath: '<built-in branch summary template>',
		templateDir: '/',
	});

	it('renders branch_messages + files_touched + contract', () => {
		const out = tpl.render(
			buildBranchSummaryRenderVars({
				branchMessagesText: '[User]: explore approach A',
				filesTouchedBlock: 'R  notes.md',
				branchEntryMessages: [
					{
						role: 'user',
						content: [{ type: 'text', text: 'explore approach A' }],
					} as never,
				],
			}) as unknown as Record<string, unknown>,
		);

		expect(out).toContain('<branch-messages>');
		expect(out).toContain('[User]: explore approach A');
		expect(out).toContain('<files-touched>');
		expect(out).toContain('R  notes.md');
		expect(out).toContain('# What to include');
		expect(out).toContain('## Purpose');
		expect(out).toContain('## All user messages on this branch');
		expect(out).not.toContain('undefined');
	});

	it('omits empty blocks', () => {
		const out = tpl.render(
			buildBranchSummaryRenderVars({
				branchEntryMessages: [],
			}) as unknown as Record<string, unknown>,
		);
		expect(out).not.toContain('<branch-messages>');
		expect(out).not.toContain('<files-touched>');
		expect(out).toContain('# What to include');
	});

	it('emits <focus> when custom_focus is set', () => {
		const out = tpl.render(
			buildBranchSummaryRenderVars({
				branchMessagesText: '[User]: investigate',
				customFocus: '/tree --focus auth-refactor',
				branchEntryMessages: [
					{
						role: 'user',
						content: [{ type: 'text', text: 'investigate' }],
					} as never,
				],
			}) as unknown as Record<string, unknown>,
		);
		expect(out).toContain('<focus>');
		expect(out).toContain('/tree --focus auth-refactor');
		expect(out).toContain('</focus>');
	});
});
