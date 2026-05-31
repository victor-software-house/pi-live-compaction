import { randomUUID } from 'node:crypto';

import { completeSimple, streamSimple as streamSimpleDefault } from '@earendil-works/pi-ai';
import {
	CompactionSummaryMessageComponent,
	convertToLlm,
	type ExtensionAPI,
	type SessionBeforeCompactEvent,
	type SessionEntry,
	serializeConversation,
} from '@earendil-works/pi-coding-agent';
import { appendCompactionAttemptEntry } from '@live-compaction/attempt-entry';
import {
	CURRENT_PRESET_SENTINEL,
	loadEffectiveBranchSummaryPromptContract,
	loadEffectiveCompactionPromptContract,
	loadEffectiveConfig,
	normalizeOptionalText,
	resolveLiveCompactionPaths,
} from '@live-compaction/config';
import { CompactionAbortedError, isAbortError } from '@live-compaction/errors';
import { collectFilesTouched } from '@live-compaction/files-touched';
import { renderFilesTouchedManifestBlock } from '@live-compaction/files-touched-manifest';
import { parseCompactInstructions, sha256 } from '@live-compaction/preset';
import type {
	HookContext,
	LiveCompactionDetails,
	NotifyLevel,
	PreparedMessages,
	ResolvedSummarizer,
	RunDeps,
	SummaryProgress,
} from '@live-compaction/runtime-types';
import {
	describeConfiguredFallback,
	describePresetFallback,
	resolveConfiguredFallbackSummarizer,
	resolveDefaultSummarizer,
	resolvePresetSummarizer,
} from '@live-compaction/summarizer';
import {
	buildSummaryOptions,
	buildSummaryRequestMessage,
	chooseSummaryTransport,
	completeWithResolvedSummarizer,
	getTextFromAssistantResponse,
	SYSTEM_PROMPT,
	stripLeakedInternals,
} from '@live-compaction/summary-stream';
import {
	buildRenderVars,
	type CompactionTemplate,
	getBuiltInCompactionTemplate,
	loadCompactionTemplate,
} from '@live-compaction/template';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASK_STATE_MAX_CHARS = 6000;

export const DEFAULT_DEPS: RunDeps = {
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
// Helpers
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
// Summarization core
// ---------------------------------------------------------------------------

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
	}
	return tail;
}

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

	const discardedText =
		params.discardedMessages.length > 0
			? serializeConversation(convertToLlm(params.discardedMessages))
			: '';
	const keptTailText =
		params.keptTailMessages.length > 0
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
// Orchestrator
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

	const discardedMessages: PreparedMessages = [
		...event.preparation.messagesToSummarize,
		...event.preparation.turnPrefixMessages,
	];

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

		if (template?.frontmatter.preset && !parsedInstructions.usesPresetDirective) {
			parsedInstructions.usesPresetDirective = true;
			parsedInstructions.presetQuery = template.frontmatter.preset;
		}

		let effectiveConfig = config;
		if (config.inheritSessionModel && !parsedInstructions.usesPresetDirective) {
			effectiveConfig = { ...config, defaultPreset: CURRENT_PRESET_SENTINEL };
		}

		const filesTouchedBlock = config.includeFilesTouched.inCompactionSummary
			? renderFilesTouchedManifestBlock(deps.collectFilesTouched(event.branchEntries, ctx.cwd)) ||
				undefined
			: undefined;

		const taskStateBlock = boundTaskStateBlock(await deps.fetchTaskState?.());
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
