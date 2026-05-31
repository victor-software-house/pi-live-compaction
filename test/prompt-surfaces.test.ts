import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertToLlm, getAgentDir, serializeConversation } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import { renderFilesTouchedManifestBlock } from '@live-compaction/files-touched-manifest';
import { DEFAULT_CONFIG } from '@live-compaction/config';
import { fetchTaskStateSnapshot, runLiveCompaction } from '@live-compaction/index';
import { SYSTEM_PROMPT } from '@live-compaction/summary-stream';
import {
	buildBranchSummaryRenderVars,
	buildRenderVars,
	loadCompactionTemplate,
	loadCompactionTemplateFromString,
} from '@live-compaction/template';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, '..');
const agentDir = getAgentDir();

const sampleMessages = convertToLlm([
	{
		role: 'user',
		content: [{ type: 'text', text: 'validate prompts and templates' }],
		timestamp: 0,
	} as never,
]);
const sampleText = serializeConversation(sampleMessages);
const filesTouchedBlock = renderFilesTouchedManifestBlock([
	{
		path: path.join(packageRoot, 'README.md'),
		displayPath: 'README.md',
		operations: new Set(['read']),
		lastTimestamp: 1000,
	},
]);
const taskStateBlock = [
	'## Task tracking state',
	'Task tools are the live continuity anchor for current goals.',
	'- #28 [in_progress] Anchor compaction with live task state',
].join('\n');
const model = {
	provider: 'custom-provider',
	id: 'custom-model',
	api: 'custom-api',
	name: 'Custom Model',
	baseUrl: 'https://example.test',
	maxTokens: 64000,
	contextWindow: 200000,
} as never;

async function renderCompactionTemplate(templatePath: string): Promise<string> {
	const template = await loadCompactionTemplate(templatePath);
	expect(template, templatePath).not.toBeNull();
	return template!.render(
		buildRenderVars({
			previousSummary: 'old prior constraints',
			discardedText: sampleText,
			keptTailText: sampleText,
			taskStateBlock,
			filesTouchedBlock,
			focusText: 'validate all prompt surfaces',
			focusInput: '/compact validate all prompt surfaces',
			discardedMessages: sampleMessages,
			keptTailMessages: sampleMessages,
			frontmatter: template!.frontmatter,
		}) as unknown as Record<string, unknown>,
	);
}

async function renderBranchSummaryTemplate(templatePath: string): Promise<string> {
	const template = await loadCompactionTemplate(templatePath);
	expect(template, templatePath).not.toBeNull();
	return template!.render(
		buildBranchSummaryRenderVars({
			branchMessagesText: sampleText,
			filesTouchedBlock,
			customFocus: 'branch focus',
			branchEntryMessages: sampleMessages,
			frontmatter: template!.frontmatter,
		}) as unknown as Record<string, unknown>,
	);
}

function expectValidRenderedPrompt(out: string): void {
	expect(out).not.toContain('undefined');
	expect(out).not.toContain('[object Object]');
	expect(out).toContain('# What to include');
}

describe('task-state RPC', () => {
	it('requests live task state from pi-tasks over event bus', async () => {
		const handlers = new Map<string, Array<(data: unknown) => void>>();
		const events = {
			on(channel: string, handler: (data: unknown) => void) {
				const list = handlers.get(channel) ?? [];
				list.push(handler);
				handlers.set(channel, list);
				return () =>
					handlers.set(
						channel,
						(handlers.get(channel) ?? []).filter((h) => h !== handler),
					);
			},
			emit(channel: string, data: unknown) {
				if (channel === 'tasks:rpc:snapshot') {
					const requestId = (data as { requestId: string }).requestId;
					for (const handler of handlers.get(`tasks:rpc:snapshot:reply:${requestId}`) ?? []) {
						handler({ success: true, data: { markdown: taskStateBlock } });
					}
				}
			},
		};

		await expect(fetchTaskStateSnapshot(events as never, 50)).resolves.toBe(taskStateBlock);
	});
});

describe('prompt/template surfaces', () => {
	const globalCompactionDir = path.join(agentDir, 'extensions/grounded-compaction');
	const hasLocalExtension = existsSync(globalCompactionDir);

	it.skipIf(!hasLocalExtension)(
		'renders live custom global compaction template with package partials',
		async () => {
			const templatePath = path.join(
				agentDir,
				'extensions/grounded-compaction/compaction-prompt.md',
			);
			expect(existsSync(templatePath), templatePath).toBe(true);

			const out = await renderCompactionTemplate(templatePath);

			expectValidRenderedPrompt(out);
			expect(out).toContain('<previous-summary>');
			expect(out).toContain('old prior constraints');
			expect(out).toContain('<task-state>');
			expect(out).toContain('#28 [in_progress] Anchor compaction with live task state');
			expect(out).toContain('<focus>');
			expect(out).toContain('validate all prompt surfaces');
			expect(out).toContain('<latest-user-ask>');
			expect(out).toContain('## Brief');
		},
	);

	it.skipIf(!hasLocalExtension)('renders live custom global branch-summary prompt', async () => {
		const templatePath = path.join(
			agentDir,
			'extensions/grounded-compaction/branch-summary-prompt.md',
		);
		expect(existsSync(templatePath), templatePath).toBe(true);

		const out = await renderBranchSummaryTemplate(templatePath);

		expectValidRenderedPrompt(out);
		expect(out).toContain('## Purpose');
		expect(out).toContain('## All user messages on this branch');
	});

	it('renders packaged compaction prompt example directly', async () => {
		const templatePath = path.join(
			packageRoot,
			'extensions/live-compaction/compaction-prompt.md.example',
		);
		const out = await renderCompactionTemplate(templatePath);

		expectValidRenderedPrompt(out);
		expect(out).toContain('<previous-summary>');
		expect(out).toContain('<task-state>');
		expect(out).toContain('<focus>');
		expect(out).toContain('<latest-user-ask>');
	});

	it('renders packaged branch-summary prompt example directly', async () => {
		const templatePath = path.join(
			packageRoot,
			'extensions/live-compaction/branch-summary-prompt.md.example',
		);
		const out = await renderBranchSummaryTemplate(templatePath);

		expectValidRenderedPrompt(out);
		expect(out).toContain('## Purpose');
		expect(out).toContain('## All user messages on this branch');
	});

	it('keeps carry-forward invariants in system prompt even with a custom minimal template', async () => {
		let capturedSystemPrompt = '';
		let capturedPromptBody = '';
		const customTemplate = loadCompactionTemplateFromString(
			'CUSTOM BODY ONLY: {{ focus }}\nTASKS: {{ task_state }}',
			{
				templatePath: '<custom minimal template>',
				templateDir: '/',
			},
		);

		await runLiveCompaction(
			{
				signal: new AbortController().signal,
				customInstructions: 'preserve this focus exactly',
				branchEntries: [
					{
						id: 'm1',
						type: 'message',
						message: {
							role: 'user',
							content: [{ type: 'text', text: 'latest raw ask' }],
							timestamp: 0,
						},
					},
				],
				preparation: {
					messagesToSummarize: [
						{
							role: 'user',
							content: [{ type: 'text', text: 'old ask' }],
							timestamp: 0,
						},
					],
					turnPrefixMessages: [],
					firstKeptEntryId: 'm1',
					previousSummary: 'old summary facts',
					tokensBefore: 123,
					settings: { reserveTokens: 4000 },
				},
			} as never,
			{
				hasUI: false,
				ui: { notify: () => undefined },
				model,
				cwd: '/tmp',
				modelRegistry: {
					getAll: () => [model],
					registeredProviders: new Map(),
					getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'token', headers: {} }),
				},
			} as never,
			{
				complete: async (_model: unknown, context: any) => {
					capturedSystemPrompt = context.systemPrompt;
					capturedPromptBody = context.messages[0].content[0].text;
					return {
						role: 'assistant',
						content: [{ type: 'text', text: 'summary' }],
						api: 'custom-api',
						provider: 'custom-provider',
						model: 'custom-model',
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: 'stop',
						timestamp: 0,
					} as never;
				},
				streamSimple: undefined,
				collectFilesTouched: () => [],
				loadConfig: async () => DEFAULT_CONFIG,
				loadCompactionPrompt: async () => '# unused',
				loadBranchSummaryPrompt: async () => 'unused',
				loadCompactionTemplate: async () => customTemplate,
				resolvePaths: () => ({
					global: { compactionPromptPath: '/tmp/custom.md' },
					project: undefined,
				}),
				fetchTaskState: async () => taskStateBlock,
			} as never,
		);

		expect(capturedSystemPrompt).toBe(SYSTEM_PROMPT);
		expect(capturedSystemPrompt).toContain(
			'will not see `<previous-summary>`, `<discarded-conversation>`, `<files-touched>`, or `<focus>` as separate blocks',
		);
		expect(capturedSystemPrompt).toContain('per `<focus>`');
		expect(capturedPromptBody).toContain('CUSTOM BODY ONLY: preserve this focus exactly');
		expect(capturedPromptBody).toContain(
			'#28 [in_progress] Anchor compaction with live task state',
		);
		expect(capturedPromptBody).not.toContain('only durable carrier');
	});
});
