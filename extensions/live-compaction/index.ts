import { createHash, randomUUID } from 'node:crypto';

import {
	completeSimple,
	streamSimple as streamSimpleDefault,
	type Message,
} from '@earendil-works/pi-ai';
import {
	CompactionSummaryMessageComponent,
	convertToLlm,
	type ExtensionAPI,
	type SessionBeforeCompactEvent,
	type SessionBeforeTreeEvent,
	type SessionEntry,
	serializeConversation,
} from '@earendil-works/pi-coding-agent';
import { collectFilesTouched, type FilesTouchedEntry } from '@shared/files-touched-core';
import { renderFilesTouchedManifestBlock } from '@shared/files-touched-manifest';
import { appendCompactionAttemptEntry } from './attempt-entry';
import { CompactionAbortedError, isAbortError } from './errors';
import { registerLiveCompactionCommand } from './command';
import {
	CURRENT_PRESET_SENTINEL,
	DEFAULT_BRANCH_SUMMARY_TEMPLATE_BODY,
	DEFAULT_COMPACTION_TEMPLATE_BODY,
	type LiveCompactionConfig,
	loadEffectiveBranchSummaryPromptContract,
	loadEffectiveCompactionPromptContract,
	loadEffectiveConfig,
	normalizeOptionalText,
	normalizeThinkingLevel,
	type PresetConfig,
	resolveLiveCompactionPaths,
	type ThinkingLevel,
} from './config';
import type {
	LiveCompactionDetails,
	HookContext,
	NotifyLevel,
	ParsedCompactInstructions,
	PreparedMessages,
	PresetMatchResult,
	ResolvedSummarizer,
	RunDeps,
	StreamSimple,
	SummaryProgress,
} from './runtime-types';
import {
	buildSummaryOptions,
	buildSummaryRequestMessage,
	chooseSummaryTransport,
	completeWithResolvedSummarizer,
	getTextFromAssistantResponse,
	SYSTEM_PROMPT,
	stripLeakedInternals,
} from './summary-stream';
import {
	buildBranchSummaryRenderVars,
	buildRenderVars,
	type CompactionTemplate,
	loadCompactionTemplate,
	loadCompactionTemplateFromString,
} from './template';

// Re-exports for external consumers
export type {
	ConfigScope,
	LiveCompactionConfig,
	LiveCompactionPaths,
	IncludeFilesTouchedSettings,
	PresetConfig,
	PromptKind,
	PromptResolution,
	ThinkingLevel,
} from './config';
export {
	CURRENT_PRESET_SENTINEL,
	DEFAULT_COMPACTION_PROMPT_CONTRACT,
	DEFAULT_CONFIG,
	loadBranchSummaryPromptContract,
	loadCompactionPromptContract,
	loadConfig,
	loadEffectiveBranchSummaryPromptContract,
	loadEffectiveCompactionPromptContract,
	loadEffectiveConfig,
	normalizeOptionalText,
	normalizeThinkingLevel,
	parseConfig,
} from './config';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// FILES_TOUCHED_HEADING / FILES_TOUCHED_LEGEND / formatManifestOperations /
// renderFilesTouchedManifestBlock all live in _shared/files-touched-manifest.ts
// so that tests + the preview CLI can import them without dragging in
// @earendil-works/pi-tui (which is only available inside Pi runtime).

const TASK_STATE_MAX_CHARS = 6000;

const DEFAULT_DEPS: RunDeps = {
	complete: completeSimple,
	streamSimple: streamSimpleDefault,
	collectFilesTouched,
	loadConfig: loadEffectiveConfig,
	loadCompactionPrompt: loadEffectiveCompactionPromptContract,
	loadBranchSummaryPrompt: loadEffectiveBranchSummaryPromptContract,
	loadCompactionTemplate,
	resolvePaths: resolveLiveCompactionPaths,
};

// ---------------------------------------------------------------------------
// /compact instruction parsing
// ---------------------------------------------------------------------------

function sha256(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

export function parseCompactInstructions(text?: string): ParsedCompactInstructions {
	const trimmed = text?.trim() ?? '';
	if (!trimmed) {
		return { usesPresetDirective: false };
	}

	if (!trimmed.startsWith('--preset') && !trimmed.startsWith('-p')) {
		return {
			usesPresetDirective: false,
			focusText: trimmed,
		};
	}

	const presetPrefixPattern = /^(?:--preset\s+|-p\s+)(\S+)\s*([\s\S]*)$/;
	const match = presetPrefixPattern.exec(trimmed);

	if (!match) {
		return { usesPresetDirective: true };
	}

	const presetQuery = match[1];
	const focusText = match[2]?.trim() || undefined;
	return { usesPresetDirective: true, presetQuery, focusText };
}

// ---------------------------------------------------------------------------
// Preset matching
// ---------------------------------------------------------------------------

function normalizePresetKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolvePresetMatch(config: LiveCompactionConfig, query: string): PresetMatchResult {
	const normalizedQuery = normalizePresetKey(query);
	if (!normalizedQuery) {
		return { kind: 'unmatched' };
	}

	if (normalizedQuery === 'current' || normalizedQuery === CURRENT_PRESET_SENTINEL) {
		return { kind: 'matched', name: CURRENT_PRESET_SENTINEL };
	}

	const exactKey = Object.keys(config.presets).find(
		(name) => normalizePresetKey(name) === normalizedQuery,
	);
	if (exactKey) {
		return {
			kind: 'matched',
			name: exactKey,
			preset: config.presets[exactKey],
		};
	}

	const prefixMatches = Object.keys(config.presets).filter((name) =>
		normalizePresetKey(name).startsWith(normalizedQuery),
	);
	if (prefixMatches.length === 1) {
		return {
			kind: 'matched',
			name: prefixMatches[0],
			preset: config.presets[prefixMatches[0]],
		};
	}
	if (prefixMatches.length > 1) {
		return { kind: 'ambiguous' };
	}

	return { kind: 'unmatched' };
}

// ---------------------------------------------------------------------------
// Model / summarizer resolution
// ---------------------------------------------------------------------------

export function getEffectiveThinkingLevel(branchEntries: SessionEntry[]): ThinkingLevel {
	for (let i = branchEntries.length - 1; i >= 0; i--) {
		const entry = branchEntries[i];
		if (entry.type === 'thinking_level_change') {
			const level = normalizeThinkingLevel(entry.thinkingLevel);
			if (level) {
				return level;
			}
		}
	}
	return 'off';
}

function parseProviderModel(value: string): {
	provider: string;
	modelId: string;
} {
	const slashIndex = value.indexOf('/');
	if (slashIndex < 0) {
		throw new Error(`Invalid model format '${value}': expected 'provider/model-id'`);
	}
	return {
		provider: value.slice(0, slashIndex),
		modelId: value.slice(slashIndex + 1),
	};
}

function getRegisteredStreamSimple(
	ctx: HookContext,
	model: ResolvedSummarizer['model'],
): StreamSimple | undefined {
	const registry = ctx.modelRegistry as unknown as {
		registeredProviders?: Map<string, { streamSimple?: StreamSimple }>;
	};
	return registry.registeredProviders?.get(model.provider)?.streamSimple;
}

export async function resolveDefaultSummarizer(
	ctx: HookContext,
	branchEntries: SessionEntry[],
): Promise<ResolvedSummarizer> {
	const model = ctx.model;
	if (!model) {
		throw new CompactionAbortedError();
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(`Auth failed for session model: ${auth.error}`);
	}

	return {
		model,
		apiKey: auth.apiKey,
		headers: auth.headers,
		reasoningLevel: getEffectiveThinkingLevel(branchEntries),
		streamSimple: getRegisteredStreamSimple(ctx, model),
	};
}

export async function resolvePresetSummarizer(
	ctx: HookContext,
	config: LiveCompactionConfig,
	presetQuery: string,
): Promise<ResolvedSummarizer> {
	const match = resolvePresetMatch(config, presetQuery);

	switch (match.kind) {
		case 'ambiguous':
			throw new Error(`Ambiguous preset query '${presetQuery}': matches multiple presets`);
		case 'unmatched':
			throw new Error(`No preset matches '${presetQuery}'`);
		case 'matched':
			break;
	}

	if (match.name === CURRENT_PRESET_SENTINEL || !match.preset) {
		const model = ctx.model;
		if (!model) {
			throw new CompactionAbortedError();
		}
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) {
			throw new Error(`Auth failed for session model: ${auth.error}`);
		}
		return {
			model,
			apiKey: auth.apiKey,
			headers: auth.headers,
			reasoningLevel: match.preset?.thinkingLevel,
			streamSimple: getRegisteredStreamSimple(ctx, model),
		};
	}

	const { provider, modelId } = parseProviderModel(match.preset.model);
	const model = ctx.modelRegistry
		.getAll()
		.find(
			(m) =>
				m.provider.toLowerCase() === provider.toLowerCase() &&
				m.id.toLowerCase() === modelId.toLowerCase(),
		);
	if (!model) {
		throw new Error(`Model '${match.preset.model}' not found in model registry`);
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(`Auth failed for preset model '${match.preset.model}': ${auth.error}`);
	}

	return {
		model,
		apiKey: auth.apiKey,
		headers: auth.headers,
		reasoningLevel: match.preset.thinkingLevel,
		streamSimple: getRegisteredStreamSimple(ctx, model),
	};
}

function describeConfiguredFallback(config: LiveCompactionConfig): string {
	if (config.fallbackPreset && config.fallbackPreset !== CURRENT_PRESET_SENTINEL) {
		return `preset '${config.fallbackPreset}'`;
	}
	return 'the current session model';
}

function describePresetFallback(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function resolveConfiguredFallbackSummarizer(
	ctx: HookContext,
	config: LiveCompactionConfig,
	branchEntries: SessionEntry[],
	excludedPreset?: string,
): Promise<ResolvedSummarizer> {
	if (
		config.fallbackPreset &&
		config.fallbackPreset !== CURRENT_PRESET_SENTINEL &&
		config.fallbackPreset !== excludedPreset
	) {
		return resolvePresetSummarizer(ctx, config, config.fallbackPreset);
	}
	return resolveDefaultSummarizer(ctx, branchEntries);
}

// ---------------------------------------------------------------------------
// Files-touched manifest (kept as optional context, not "authoritative")
// ---------------------------------------------------------------------------

// Re-export so older imports (`from "./index"`) keep working.
export {
	formatManifestOperations,
	renderFilesTouchedManifestBlock,
} from '@shared/files-touched-manifest';

// ---------------------------------------------------------------------------
// Notify helper
// ---------------------------------------------------------------------------

function notify(ctx: HookContext, message: string, level: NotifyLevel = 'warning'): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	}
}

function boundTaskStateBlock(value: string | undefined): string | undefined {
	const normalized = normalizeOptionalText(value);
	if (!normalized) return undefined;
	if (normalized.length <= TASK_STATE_MAX_CHARS) return normalized;
	return `${normalized.slice(0, TASK_STATE_MAX_CHARS)}\n- … task state truncated; call TaskRead after resume.`;
}

export function fetchTaskStateSnapshot(
	events: ExtensionAPI['events'],
	timeoutMs = 750,
): Promise<string | undefined> {
	const requestId = randomUUID();
	return new Promise((resolve) => {
		let settled = false;
		const done = (value: string | undefined) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			unsub();
			resolve(value?.trim() || undefined);
		};
		const timer = setTimeout(() => done(undefined), timeoutMs);
		const unsub = events.on(`tasks:rpc:snapshot:reply:${requestId}`, (raw: unknown) => {
			const reply = raw as { success?: boolean; data?: { markdown?: string }; error?: string };
			done(reply.success ? reply.data?.markdown : undefined);
		});
		events.emit('tasks:rpc:snapshot', { requestId, consumer: 'live-compaction' });
	});
}

function makeSummaryProgress(ctx: HookContext): SummaryProgress | undefined {
	if (!ctx.hasUI) return undefined;
	if (!ctx.ui.setStatus && !ctx.ui.setWidget && !ctx.ui.setWorkingMessage) {
		return undefined;
	}

	const key = 'live-compaction';
	let lastUpdate = 0;
	let started = false;
	let tokensBefore = 0;

	const setCompactionWidget = (summary: string) => {
		ctx.ui.setWidget?.(
			key,
			() => {
				const component = new CompactionSummaryMessageComponent({
					role: 'compactionSummary',
					summary: summary.trimEnd() || '_Waiting for model output…_',
					tokensBefore,
					timestamp: Date.now(),
				});
				component.setExpanded(true);
				return component;
			},
			{ placement: 'aboveEditor' },
		);
	};

	const clear = () => {
		ctx.ui.setStatus?.(key, undefined);
		ctx.ui.setWidget?.(key, undefined);
		ctx.ui.setWorkingMessage?.();
	};

	return {
		start(modelLabel: string, compactedTokensBefore: number) {
			started = true;
			tokensBefore = compactedTokensBefore;
			ctx.ui.setStatus?.(key, `compacting with ${modelLabel}`);
			ctx.ui.setWorkingMessage?.(`Compacting with ${modelLabel}…`);
			setCompactionWidget('');
		},
		update(text: string) {
			if (!started) return;
			const now = Date.now();
			if (now - lastUpdate < 150) return;
			lastUpdate = now;
			const lineCount = text ? text.split('\n').length : 0;
			ctx.ui.setStatus?.(key, `compacting · ${lineCount} lines`);
			setCompactionWidget(text);
		},
		finish() {
			clear();
		},
		fail(message: string) {
			ctx.ui.setStatus?.(key, `compaction failed: ${message}`);
			ctx.ui.setWidget?.(key, [`Grounded compaction failed: ${message}`], {
				placement: 'aboveEditor',
			});
			ctx.ui.setWorkingMessage?.();
		},
	};
}

// ---------------------------------------------------------------------------
// Summarization core — follows pi's default approach
// ---------------------------------------------------------------------------

/**
 * Collect the messages that pi will keep verbatim after this compaction.
 *
 * pi keeps every entry from `firstKeptEntryId` to the end of the active branch
 * raw in the next session context. They define current objective, current
 * state, latest user intent, and the immediate next step. The summary model
 * needs to see them so its 'Brief / Status / Immediate next steps' sections
 * reflect reality, not the discarded older history alone.
 */
function collectKeptTailMessages(
	branchEntries: SessionEntry[],
	firstKeptEntryId: string | undefined,
): PreparedMessages {
	if (!firstKeptEntryId) return [];
	const startIndex = branchEntries.findIndex((e) => e.id === firstKeptEntryId);
	if (startIndex < 0) return [];

	const tail: PreparedMessages = [];
	for (let i = startIndex; i < branchEntries.length; i++) {
		const entry = branchEntries[i];
		if (entry.type === 'message') {
			tail.push(entry.message);
		}
		// custom_message / branch_summary / compaction in the kept tail are rare
		// before another compaction lands and require non-public message factories
		// to convert. They are skipped intentionally rather than mis-serialized.
	}
	return tail;
}

/**
 * Built-in compaction template compiled once and reused for every
 * fallback render. The body lives in config.ts so it can also be
 * inspected by tests and the preview CLI without going through this
 * module.
 */
let builtInCompactionTemplate: CompactionTemplate | null = null;
function getBuiltInCompactionTemplate(): CompactionTemplate {
	if (!builtInCompactionTemplate) {
		builtInCompactionTemplate = loadCompactionTemplateFromString(DEFAULT_COMPACTION_TEMPLATE_BODY, {
			templatePath: '<built-in compaction template>',
			// Synthetic dir; the built-in body has no `{% include %}`s, so
			// partial resolution never fires.
			templateDir: '/',
		});
	}
	return builtInCompactionTemplate;
}

let builtInBranchSummaryTemplate: CompactionTemplate | null = null;
function getBuiltInBranchSummaryTemplate(): CompactionTemplate {
	if (!builtInBranchSummaryTemplate) {
		builtInBranchSummaryTemplate = loadCompactionTemplateFromString(
			DEFAULT_BRANCH_SUMMARY_TEMPLATE_BODY,
			{
				templatePath: '<built-in branch summary template>',
				templateDir: '/',
			},
		);
	}
	return builtInBranchSummaryTemplate;
}

/**
 * Core summarization call.
 *
 * The template owns prompt layout — block ordering, conditional sections,
 * partials, macros. This function only:
 *
 *   1. serializes spans to text
 *   2. builds the variable bag (`CompactionRenderVars`)
 *   3. renders the template, falling back to a fixed assembly when no
 *      template file is configured or rendering fails
 *   4. issues the single completion request
 */
async function executeSummaryCall(
	params: {
		summarizer: ResolvedSummarizer;
		template: CompactionTemplate | null;
		promptContract: string;
		discardedMessages: PreparedMessages;
		keptTailMessages: PreparedMessages;
		previousSummary?: string;
		focusText?: string;
		focusInput?: string;
		filesTouchedBlock?: string;
		taskStateBlock?: string;
		reserveTokens: number;
		tokensBefore: number;
		signal: AbortSignal;
		attemptId?: string;
		notify?: (message: string, level: NotifyLevel) => void;
		progress?: SummaryProgress;
	},
	deps: RunDeps,
): Promise<string> {
	if (params.signal.aborted) {
		throw new CompactionAbortedError();
	}

	const discardedText = params.discardedMessages.length
		? serializeConversation(convertToLlm(params.discardedMessages))
		: '';
	const keptTailText = params.keptTailMessages.length
		? serializeConversation(convertToLlm(params.keptTailMessages))
		: '';

	let promptText: string | undefined;

	if (params.template) {
		const vars = buildRenderVars({
			previousSummary: params.previousSummary,
			discardedText,
			keptTailText,
			taskStateBlock: params.taskStateBlock,
			filesTouchedBlock: params.filesTouchedBlock,
			focusText: params.focusText,
			focusInput: params.focusInput,
			discardedMessages: convertToLlm(params.discardedMessages),
			keptTailMessages: convertToLlm(params.keptTailMessages),
			frontmatter: params.template.frontmatter,
		});
		try {
			promptText = params.template.render(vars as unknown as Record<string, unknown>);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			params.notify?.(
				`Compaction template failed (${message}). Falling back to default block layout.`,
				'warning',
			);
			promptText = undefined;
		}
	}

	if (!promptText) {
		// Built-in fallback: same liquid template, same render path. We
		// rebuild render vars without a frontmatter override so the built-in
		// body's structure is the only source of truth here.
		const fallback = getBuiltInCompactionTemplate();
		const vars = buildRenderVars({
			previousSummary: params.previousSummary,
			discardedText,
			keptTailText,
			taskStateBlock: params.taskStateBlock,
			filesTouchedBlock: params.filesTouchedBlock,
			focusText: params.focusText,
			focusInput: params.focusInput,
			discardedMessages: convertToLlm(params.discardedMessages),
			keptTailMessages: convertToLlm(params.keptTailMessages),
			frontmatter: fallback.frontmatter,
		});
		promptText = fallback.render(vars as unknown as Record<string, unknown>);
	}

	// Build completion options. If the active provider was registered by an
	// extension with a custom streamSimple wrapper, use it instead of the raw
	// package-level completeSimple fallback. That preserves provider-owned
	// request/auth shaping for any provider, not only the built-in registry.
	const options = buildSummaryOptions({
		summarizer: params.summarizer,
		reserveTokens: params.reserveTokens,
		signal: params.signal,
	});

	appendCompactionAttemptEntry(deps.appendEntry, params.attemptId, {
		event: 'request_rendered',
		model: `${params.summarizer.model.provider}/${params.summarizer.model.id}`,
		thinkingLevel: params.summarizer.reasoningLevel,
		focusInput: params.focusInput,
		focusText: params.focusText,
		promptChars: promptText.length,
		renderedPromptChars: promptText.length,
		systemPromptChars: SYSTEM_PROMPT.length,
		renderedPromptSha256: sha256(promptText),
		systemPromptSha256: sha256(SYSTEM_PROMPT),
		renderedPrompt: promptText,
		systemPrompt: SYSTEM_PROMPT,
		discardedMessages: params.discardedMessages.length,
		keptTailMessages: params.keptTailMessages.length,
		taskStateChars: params.taskStateBlock?.length ?? 0,
		tokensBefore: params.tokensBefore,
		transport: options.transport,
	});

	const response = await completeWithResolvedSummarizer(
		params.summarizer,
		{
			systemPrompt: SYSTEM_PROMPT,
			messages: [buildSummaryRequestMessage(promptText)],
		},
		options,
		deps,
		params.progress,
		params.tokensBefore,
	);

	if (params.signal.aborted || response.stopReason === 'aborted') {
		throw new CompactionAbortedError();
	}

	const recoveredDiagnostic = response.diagnostics?.find(
		(diagnostic) => diagnostic.type === 'live-compaction-stream-recovered',
	);
	if (recoveredDiagnostic) {
		appendCompactionAttemptEntry(deps.appendEntry, params.attemptId, {
			event: 'stream_recovered',
			error: recoveredDiagnostic.error,
			recoveredChars: getTextFromAssistantResponse(response).length,
		});
	}

	if (response.stopReason === 'error') {
		throw new Error(response.errorMessage || 'Summarization failed');
	}

	const text = getTextFromAssistantResponse(response);
	if (!text) {
		throw new Error('Summarization returned empty output');
	}

	return stripLeakedInternals(text);
}

// ---------------------------------------------------------------------------
// Main summarization orchestrator
// ---------------------------------------------------------------------------

async function summarizeWithResolvedModel(
	params: {
		event: SessionBeforeCompactEvent;
		template: CompactionTemplate | null;
		promptContract: string;
		summarizer: ResolvedSummarizer;
		focusText?: string;
		focusInput?: string;
		previousSummary?: string;
		filesTouchedBlock?: string;
		taskStateBlock?: string;
		attemptId?: string;
		notify?: (message: string, level: NotifyLevel) => void;
		progress?: SummaryProgress;
	},
	deps: RunDeps,
): Promise<string> {
	const {
		event,
		template,
		promptContract,
		summarizer,
		focusText,
		focusInput,
		previousSummary,
		filesTouchedBlock,
		taskStateBlock,
	} = params;

	// Discarded span: messages pi will replace by the summary. Pi already split
	// the cut into a head plus an optional split-turn prefix; we reunite them
	// in chronological order.
	const discardedMessages: PreparedMessages = [
		...event.preparation.messagesToSummarize,
		...event.preparation.turnPrefixMessages,
	];

	// Kept tail: messages pi will keep raw after compaction. Without these the
	// summary model only sees old discarded history and cannot describe the
	// current objective, latest user intent, or next step.
	const keptTailMessages = collectKeptTailMessages(
		event.branchEntries,
		event.preparation.firstKeptEntryId,
	);

	return executeSummaryCall(
		{
			summarizer,
			template,
			promptContract,
			discardedMessages,
			keptTailMessages,
			previousSummary,
			focusText,
			focusInput,
			filesTouchedBlock,
			taskStateBlock,
			reserveTokens: event.preparation.settings.reserveTokens,
			tokensBefore: event.preparation.tokensBefore,
			signal: event.signal,
			attemptId: params.attemptId,
			notify: params.notify,
			progress: params.progress,
		},
		deps,
	);
}

function buildSuccessResult(
	event: SessionBeforeCompactEvent,
	summary: string,
	summarizer: ResolvedSummarizer,
	metadata?: {
		focusInput?: string;
		focusText?: string;
		presetQuery?: string;
		attemptId?: string;
		transport?: string;
	},
) {
	return {
		compaction: {
			summary,
			firstKeptEntryId: event.preparation.firstKeptEntryId,
			tokensBefore: event.preparation.tokensBefore,
			details: {
				model: `${summarizer.model.provider}/${summarizer.model.id}`,
				...(summarizer.reasoningLevel !== undefined
					? { thinkingLevel: summarizer.reasoningLevel }
					: {}),
				...(chooseSummaryTransport(summarizer) !== undefined
					? { transport: chooseSummaryTransport(summarizer) }
					: {}),
				...(metadata?.focusInput !== undefined ? { focusInput: metadata.focusInput } : {}),
				...(metadata?.focusText !== undefined ? { focusText: metadata.focusText } : {}),
				...(metadata?.presetQuery !== undefined ? { presetQuery: metadata.presetQuery } : {}),
				...(metadata?.attemptId !== undefined ? { attemptId: metadata.attemptId } : {}),
				...(metadata?.transport !== undefined ? { transport: metadata.transport } : {}),
			} satisfies LiveCompactionDetails,
		},
	};
}

// ---------------------------------------------------------------------------
// Branch summary augmentation (session_before_tree)
// ---------------------------------------------------------------------------

export async function runGroundedBranchSummaryAugmentation(
	event: SessionBeforeTreeEvent,
	ctx: HookContext,
	deps: RunDeps = DEFAULT_DEPS,
): Promise<{ customInstructions: string; replaceInstructions: boolean } | undefined> {
	if (
		event.signal.aborted ||
		!event.preparation.userWantsSummary ||
		event.preparation.entriesToSummarize.length === 0
	) {
		return undefined;
	}

	try {
		const config = await deps.loadConfig(ctx.cwd);

		// Try the project-or-global on-disk template first, fall back to the
		// built-in liquid template, then to the legacy plain-markdown
		// contract for backward compat.
		const paths = deps.resolvePaths(ctx.cwd);
		const templatePath =
			paths.project?.branchSummaryPromptPath ?? paths.global.branchSummaryPromptPath;
		let template: CompactionTemplate | null = null;
		try {
			template = await deps.loadCompactionTemplate(templatePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			notify(
				ctx,
				`Failed to load branch-summary template ${templatePath}: ${message}. Falling back to built-in.`,
				'warning',
			);
			template = null;
		}

		// Files-touched manifest is rendered up front so it can be passed in
		// as a render var (and so the legacy non-template path keeps working).
		const filesTouchedBlock = config.includeFilesTouched.inBranchSummary
			? renderFilesTouchedManifestBlock(
					deps.collectFilesTouched(event.preparation.entriesToSummarize, ctx.cwd),
				) || undefined
			: undefined;

		// Collect raw branch messages so the template can iterate them.
		const branchEntryMessages: Message[] = [];
		for (const entry of event.preparation.entriesToSummarize) {
			if (entry.type === 'message') {
				branchEntryMessages.push(entry.message as unknown as Message);
			}
		}
		const branchMessagesText = branchEntryMessages.length
			? serializeConversation(convertToLlm(branchEntryMessages))
			: undefined;

		const customFocus = event.preparation.customInstructions || undefined;

		// Render path: on-disk template wins, then built-in liquid template.
		let promptText: string | undefined;
		const renderTemplate = template ?? getBuiltInBranchSummaryTemplate();
		try {
			const vars = buildBranchSummaryRenderVars({
				previousSummary: undefined, // /tree does not provide one
				branchMessagesText,
				filesTouchedBlock,
				customFocus,
				branchEntryMessages,
				frontmatter: renderTemplate.frontmatter,
			});
			promptText = renderTemplate.render(vars as unknown as Record<string, unknown>);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			notify(
				ctx,
				`Branch-summary template render failed (${message}). Falling back to legacy assembly.`,
				'warning',
			);
			promptText = undefined;
		}

		// Final fallback: legacy hand-assembled sections (covers the case
		// where even the built-in liquid template fails to compile, which
		// should only happen during local engine breakage).
		if (!promptText) {
			const promptContract = await deps.loadBranchSummaryPrompt(ctx.cwd);
			if (!promptContract && !filesTouchedBlock && !customFocus) {
				return undefined;
			}
			const sections: string[] = [];
			if (promptContract) sections.push(promptContract);
			if (customFocus) {
				sections.push(`## Additional focus\n\n${customFocus}`);
			}
			if (filesTouchedBlock) {
				sections.push(`## Files touched context\n\n${filesTouchedBlock}`);
			}
			promptText = sections.join('\n\n').trim();
		}

		if (!promptText.trim()) {
			return undefined;
		}

		return {
			customInstructions: promptText.trim(),
			// Replace pi's default branch-summary instructions whenever we
			// render through a template (built-in or otherwise) so the user
			// sees a coherent prompt instead of pi's default + our extra.
			replaceInstructions: true,
		};
	} catch (error) {
		if (event.signal.aborted) {
			return undefined;
		}

		const message = error instanceof Error ? error.message : String(error);
		notify(ctx, `Branch summary augmentation failed: ${message}`, 'warning');
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Main compaction handler (session_before_compact)
// ---------------------------------------------------------------------------

export async function runLiveCompaction(
	event: SessionBeforeCompactEvent,
	ctx: HookContext,
	deps: RunDeps = DEFAULT_DEPS,
): Promise<
	| {
			compaction: {
				summary: string;
				firstKeptEntryId: string;
				tokensBefore: number;
				details: LiveCompactionDetails;
			};
	  }
	| { cancel: true }
	| undefined
> {
	try {
		const config = await deps.loadConfig(ctx.cwd);
		const promptContract = await deps.loadCompactionPrompt(ctx.cwd);
		const parsedInstructions = parseCompactInstructions(event.customInstructions);

		// Resolve the active prompt template (project override beats global).
		// A null template means "use the fallback block layout"; pi continues to
		// honour the markdown contract that loadCompactionPrompt returned.
		const paths = deps.resolvePaths(ctx.cwd);
		const attemptId = randomUUID();
		const attemptMetadata = {
			focusInput: event.customInstructions,
			focusText: parsedInstructions.focusText,
			presetQuery: parsedInstructions.presetQuery,
			attemptId,
		};
		appendCompactionAttemptEntry(deps.appendEntry, attemptId, {
			event: 'start',
			focusInput: event.customInstructions,
			focusText: parsedInstructions.focusText,
			presetQuery: parsedInstructions.presetQuery,
			tokensBefore: event.preparation.tokensBefore,
			firstKeptEntryId: event.preparation.firstKeptEntryId,
		});
		const templatePath = paths.project?.compactionPromptPath ?? paths.global.compactionPromptPath;
		let template: CompactionTemplate | null = null;
		try {
			template = await deps.loadCompactionTemplate(templatePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			notify(
				ctx,
				`Failed to load compaction template ${templatePath}: ${message}. Falling back to default block layout.`,
				'warning',
			);
			template = null;
		}
		const notifyHook = (message: string, level: NotifyLevel) => notify(ctx, message, level);
		const progress = makeSummaryProgress(ctx);

		// Frontmatter can override defaultPreset/thinking. Explicit /compact
		// --preset still wins; we only use the template's preset when the
		// directive does not specify one.
		if (template?.frontmatter.preset && !parsedInstructions.usesPresetDirective) {
			parsedInstructions.usesPresetDirective = true;
			parsedInstructions.presetQuery = template.frontmatter.preset;
		}

		// `inheritSessionModel` flag (off by default).
		//
		// When the operator opts in, an automatic /compact run that would
		// otherwise pick up `config.defaultPreset` is forced to use the
		// current session model + thinking level instead. The two deliberate
		// per-run overrides keep precedence:
		//
		//   1. `/compact --preset NAME`          explicit operator directive
		//   2. template frontmatter `preset:`    explicit template author choice
		//
		// We implement this by clobbering the *runtime* defaultPreset on a
		// shallow copy of the config so the rest of the resolution code can
		// stay unchanged.
		let effectiveConfig = config;
		if (config.inheritSessionModel && !parsedInstructions.usesPresetDirective) {
			effectiveConfig = { ...config, defaultPreset: CURRENT_PRESET_SENTINEL };
		}

		// Build optional files-touched context
		const filesTouchedBlock = config.includeFilesTouched.inCompactionSummary
			? renderFilesTouchedManifestBlock(deps.collectFilesTouched(event.branchEntries, ctx.cwd)) ||
				undefined
			: undefined;

		const taskStateBlock = boundTaskStateBlock(await deps.fetchTaskState?.());

		// Strip any previously appended manifest tails from the prior summary
		const previousSummary = normalizeOptionalText(event.preparation.previousSummary);

		// --- Preset path: explicit --preset in /compact args ---
		let skipDefaultPreset = false;
		if (parsedInstructions.usesPresetDirective && parsedInstructions.presetQuery) {
			try {
				const summarizer =
					parsedInstructions.presetQuery === CURRENT_PRESET_SENTINEL
						? await resolveDefaultSummarizer(ctx, event.branchEntries)
						: await resolvePresetSummarizer(ctx, config, parsedInstructions.presetQuery);
				const summary = await summarizeWithResolvedModel(
					{
						event,
						template,
						promptContract,
						summarizer,
						focusText: parsedInstructions.focusText,
						focusInput: event.customInstructions,
						previousSummary,
						filesTouchedBlock,
						taskStateBlock,
						attemptId,
						notify: notifyHook,
						progress,
					},
					deps,
				);
				progress?.finish();
				appendCompactionAttemptEntry(deps.appendEntry, attemptId, {
					event: 'success',
					summaryChars: summary.length,
				});
				return buildSuccessResult(event, summary, summarizer, attemptMetadata);
			} catch (error) {
				progress?.finish();
				if (isAbortError(error)) {
					appendCompactionAttemptEntry(deps.appendEntry, attemptId, { event: 'aborted' });
					return { cancel: true };
				}
				appendCompactionAttemptEntry(deps.appendEntry, attemptId, {
					event: 'preset_failed',
					error: error instanceof Error ? error.message : String(error),
				});
				notify(
					ctx,
					`Preset compaction failed (${describePresetFallback(error)}). Falling back to ${describeConfiguredFallback(config)}.`,
					'warning',
				);
				skipDefaultPreset = true;
			}
		} else if (parsedInstructions.usesPresetDirective) {
			notify(
				ctx,
				`Malformed preset directive. Falling back to ${describeConfiguredFallback(config)}.`,
				'warning',
			);
			skipDefaultPreset = true;
		}

		// --- Default path: configured default preset or session model ---
		try {
			let summarizer: ResolvedSummarizer;

			if (skipDefaultPreset) {
				summarizer = await resolveConfiguredFallbackSummarizer(
					ctx,
					effectiveConfig,
					event.branchEntries,
					parsedInstructions.presetQuery,
				);
			} else if (effectiveConfig.defaultPreset === CURRENT_PRESET_SENTINEL) {
				summarizer = await resolveDefaultSummarizer(ctx, event.branchEntries);
			} else {
				try {
					summarizer = await resolvePresetSummarizer(
						ctx,
						effectiveConfig,
						effectiveConfig.defaultPreset,
					);
				} catch (error) {
					if (isAbortError(error)) {
						return { cancel: true };
					}
					notify(
						ctx,
						`Default preset '${effectiveConfig.defaultPreset}' failed (${describePresetFallback(error)}). Falling back to ${describeConfiguredFallback(effectiveConfig)}.`,
						'warning',
					);
					summarizer = await resolveConfiguredFallbackSummarizer(
						ctx,
						effectiveConfig,
						event.branchEntries,
						effectiveConfig.defaultPreset,
					);
				}
			}

			const summary = await summarizeWithResolvedModel(
				{
					event,
					template,
					promptContract,
					summarizer,
					focusText: parsedInstructions.focusText,
					focusInput: event.customInstructions,
					previousSummary,
					filesTouchedBlock,
					taskStateBlock,
					attemptId,
					notify: notifyHook,
					progress,
				},
				deps,
			);
			progress?.finish();
			appendCompactionAttemptEntry(deps.appendEntry, attemptId, {
				event: 'success',
				summaryChars: summary.length,
			});
			return buildSuccessResult(event, summary, summarizer, attemptMetadata);
		} catch (error) {
			if (isAbortError(error)) {
				progress?.finish();
				appendCompactionAttemptEntry(deps.appendEntry, attemptId, { event: 'aborted' });
				return { cancel: true };
			}
			const message = error instanceof Error ? error.message : String(error);
			progress?.fail(message);
			appendCompactionAttemptEntry(deps.appendEntry, attemptId, {
				event: 'failed',
				error: message,
			});
			notify(ctx, `Grounded compaction failed: ${message}`, 'warning');
			return parsedInstructions.usesPresetDirective ? { cancel: true } : undefined;
		}
	} catch (error) {
		if (isAbortError(error) || event.signal.aborted) {
			return { cancel: true };
		}
		const message = error instanceof Error ? error.message : String(error);
		notify(ctx, `Grounded compaction failed: ${message}`, 'warning');
		const parsedInstructions = parseCompactInstructions(event.customInstructions);
		return parsedInstructions.usesPresetDirective ? { cancel: true } : undefined;
	}
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function liveCompactionExtension(pi: ExtensionAPI): void {
	registerLiveCompactionCommand(pi);

	pi.on('session_before_compact', async (event, ctx) => {
		return runLiveCompaction(event, ctx, {
			...DEFAULT_DEPS,
			fetchTaskState: () => fetchTaskStateSnapshot(pi.events),
			appendEntry: pi.appendEntry.bind(pi),
		});
	});

	pi.on('session_before_tree', async (event, ctx) => {
		return runGroundedBranchSummaryAugmentation(event, ctx);
	});
}
