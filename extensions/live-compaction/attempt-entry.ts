export const COMPACTION_ATTEMPT_CUSTOM_TYPE = "live-compaction.attempt";

export type AppendEntry = (customType: string, data?: unknown) => void;

export type CompactionAttemptEntry = {
	schemaVersion: 1;
	attemptId: string;
	timestamp: number;
	event:
		| "start"
		| "request_rendered"
		| "stream_recovered"
		| "success"
		| "preset_failed"
		| "failed"
		| "aborted";
	focusInput?: string;
	focusText?: string;
	presetQuery?: string;
	model?: string;
	thinkingLevel?: string;
	promptChars?: number;
	renderedPromptChars?: number;
	systemPromptChars?: number;
	renderedPromptSha256?: string;
	systemPromptSha256?: string;
	renderedPrompt?: string;
	systemPrompt?: string;
	discardedMessages?: number;
	keptTailMessages?: number;
	taskStateChars?: number;
	tokensBefore?: number;
	firstKeptEntryId?: string;
	transport?: string;
	summaryChars?: number;
	error?: unknown;
	recoveredChars?: number;
};

export function appendCompactionAttemptEntry(
	appendEntry: AppendEntry | undefined,
	attemptId: string | undefined,
	entry: Omit<CompactionAttemptEntry, "schemaVersion" | "attemptId" | "timestamp">,
): void {
	if (!appendEntry || !attemptId) return;
	try {
		appendEntry(COMPACTION_ATTEMPT_CUSTOM_TYPE, {
			schemaVersion: 1,
			attemptId,
			timestamp: Date.now(),
			...entry,
		} satisfies CompactionAttemptEntry);
	} catch {
		// Attempt entries are recovery/debug state. Never let them break compaction.
	}
}
