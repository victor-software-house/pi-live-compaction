import {
	convertToLlm,
	type SessionBeforeCompactEvent,
	serializeConversation,
} from '@earendil-works/pi-coding-agent';

import { appendCompactionAttemptEntry } from '@live-compaction/attempt-entry';
import { collectKeptTailMessages } from '@live-compaction/compaction/result';
import { CompactionAbortedError } from '@live-compaction/errors';
import { sha256 } from '@live-compaction/preset';
import {
	buildSummaryOptions,
	buildSummaryRequestMessage,
	completeWithResolvedSummarizer,
	getTextFromAssistantResponse,
	SYSTEM_PROMPT,
	stripLeakedInternals,
} from '@live-compaction/summary';
import {
	buildRenderVars,
	type CompactionTemplate,
	getBuiltInCompactionTemplate,
} from '@live-compaction/template';
import type {
	NotifyLevel,
	PreparedMessages,
	ResolvedSummarizer,
	RunDeps,
	SummaryProgress,
} from '@live-compaction/types';

export async function executeSummaryCall(
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

export async function summarizeWithResolvedModel(
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
