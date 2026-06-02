import { randomUUID } from 'node:crypto';

import { completeSimple, streamSimple as streamSimpleDefault } from '@earendil-works/pi-ai';
import type { SessionBeforeCompactEvent } from '@earendil-works/pi-coding-agent';

import { appendCompactionAttemptEntry } from '@live-compaction/attempt-entry';
import { summarizeWithResolvedModel } from '@live-compaction/compaction/orchestrator';
import {
	boundTaskStateBlock,
	makeSummaryProgress,
	notify,
} from '@live-compaction/compaction/progress';
import { buildSuccessResult } from '@live-compaction/compaction/result';
import {
	CURRENT_PRESET_SENTINEL,
	loadEffectiveBranchSummaryPromptContract,
	loadEffectiveCompactionPromptContract,
	loadEffectiveConfig,
	normalizeOptionalText,
	resolveLiveCompactionPaths,
} from '@live-compaction/config';
import { isAbortError } from '@live-compaction/errors';
import {
	collectFilesTouched,
	renderFilesTouchedManifestBlock,
} from '@live-compaction/files-touched';
import {
	describeConfiguredFallback,
	describePresetFallback,
	parseCompactInstructions,
	resolveConfiguredFallbackSummarizer,
	resolveDefaultSummarizer,
	resolvePresetSummarizer,
} from '@live-compaction/preset';
import { loadCompactionTemplate } from '@live-compaction/template';
import type {
	HookContext,
	LiveCompactionDetails,
	ResolvedSummarizer,
	RunDeps,
} from '@live-compaction/types';
import { safeUI } from '@live-compaction/types';

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

// Re-export for external consumers (index.ts, tests)
export { fetchTaskStateSnapshot } from '@live-compaction/compaction/progress';

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
	const safeCtx: HookContext = { ...ctx, ui: safeUI(ctx) };
	try {
		const config = await deps.loadConfig(safeCtx.cwd);
		const promptContract = await deps.loadCompactionPrompt(safeCtx.cwd);
		const parsedInstructions = parseCompactInstructions(event.customInstructions);

		const paths = deps.resolvePaths(safeCtx.cwd);
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
		let template = null;
		try {
			template = await deps.loadCompactionTemplate(templatePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			notify(
				safeCtx,
				`Failed to load compaction template ${templatePath}: ${message}. Falling back to default block layout.`,
				'warning',
			);
			template = null;
		}
		const notifyHook = (message: string, level: Parameters<typeof notify>[2]) =>
			notify(safeCtx, message, level);
		const progress = deps.makeProgress?.(safeCtx) ?? makeSummaryProgress(safeCtx);

		if (template?.frontmatter.preset && !parsedInstructions.usesPresetDirective) {
			parsedInstructions.usesPresetDirective = true;
			parsedInstructions.presetQuery = template.frontmatter.preset;
		}

		let effectiveConfig = config;
		if (config.inheritSessionModel && !parsedInstructions.usesPresetDirective) {
			effectiveConfig = { ...config, defaultPreset: CURRENT_PRESET_SENTINEL };
		}

		const filesTouchedBlock = config.includeFilesTouched.inCompactionSummary
			? renderFilesTouchedManifestBlock(
					deps.collectFilesTouched(event.branchEntries, safeCtx.cwd),
				) || undefined
			: undefined;

		const taskStateBlock = boundTaskStateBlock(await deps.fetchTaskState?.());
		const previousSummary = normalizeOptionalText(event.preparation.previousSummary);

		// --- Preset path: explicit --preset in /compact args ---
		let skipDefaultPreset = false;
		if (parsedInstructions.usesPresetDirective && parsedInstructions.presetQuery) {
			try {
				const summarizer: ResolvedSummarizer =
					parsedInstructions.presetQuery === CURRENT_PRESET_SENTINEL
						? await resolveDefaultSummarizer(safeCtx, event.branchEntries)
						: await resolvePresetSummarizer(safeCtx, config, parsedInstructions.presetQuery);
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
					safeCtx,
					`Preset compaction failed (${describePresetFallback(error)}). Falling back to ${describeConfiguredFallback(config)}.`,
					'warning',
				);
				skipDefaultPreset = true;
			}
		} else if (parsedInstructions.usesPresetDirective) {
			notify(
				safeCtx,
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
					safeCtx,
					effectiveConfig,
					event.branchEntries,
					parsedInstructions.presetQuery,
				);
			} else if (effectiveConfig.defaultPreset === CURRENT_PRESET_SENTINEL) {
				summarizer = await resolveDefaultSummarizer(safeCtx, event.branchEntries);
			} else {
				try {
					summarizer = await resolvePresetSummarizer(
						safeCtx,
						effectiveConfig,
						effectiveConfig.defaultPreset,
					);
				} catch (error) {
					if (isAbortError(error)) return { cancel: true };
					notify(
						safeCtx,
						`Default preset '${effectiveConfig.defaultPreset}' failed (${describePresetFallback(error)}). Falling back to ${describeConfiguredFallback(effectiveConfig)}.`,
						'warning',
					);
					summarizer = await resolveConfiguredFallbackSummarizer(
						safeCtx,
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
			notify(safeCtx, `Grounded compaction failed: ${message}`, 'warning');
			return parsedInstructions.usesPresetDirective ? { cancel: true } : undefined;
		}
	} catch (error) {
		if (isAbortError(error) || event.signal.aborted) return { cancel: true };
		const message = error instanceof Error ? error.message : String(error);
		notify(safeCtx, `Grounded compaction failed: ${message}`, 'warning');
		const parsedInstructions = parseCompactInstructions(event.customInstructions);
		return parsedInstructions.usesPresetDirective ? { cancel: true } : undefined;
	}
}
