import type { SessionBeforeCompactEvent, SessionEntry } from '@earendil-works/pi-coding-agent';

import { chooseSummaryTransport } from '@live-compaction/summary';
import type {
	LiveCompactionDetails,
	PreparedMessages,
	ResolvedSummarizer,
} from '@live-compaction/types';

export function collectKeptTailMessages(
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

export function buildSuccessResult(
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
