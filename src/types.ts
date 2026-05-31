import type {
	Api,
	AssistantMessageEventStream,
	Context,
	completeSimple,
	Model,
	SimpleStreamOptions,
	streamSimple as streamSimpleDefault,
} from '@earendil-works/pi-ai';
import type { convertToLlm, ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { AppendEntry } from '@live-compaction/attempt-entry';
import type {
	loadEffectiveBranchSummaryPromptContract,
	loadEffectiveCompactionPromptContract,
	loadEffectiveConfig,
	PresetConfig,
	resolveLiveCompactionPaths,
	ThinkingLevel,
} from '@live-compaction/config';
import type { collectFilesTouched } from '@live-compaction/files-touched';
import type { loadCompactionTemplate } from '@live-compaction/template';

export type NotifyLevel = 'info' | 'warning' | 'error';
export type ReasoningLevel = Exclude<ThinkingLevel, 'off'>;
export type PreparedMessages = Parameters<typeof convertToLlm>[0];
export type StreamSimple = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export interface ParsedCompactInstructions {
	usesPresetDirective: boolean;
	presetQuery?: string;
	focusText?: string;
}

export interface ResolvedSummarizer {
	model: Model<Api>;
	apiKey?: string;
	headers?: Record<string, string>;
	reasoningLevel?: ThinkingLevel;
	streamSimple?: StreamSimple;
}

export interface LiveCompactionDetails {
	model: string;
	thinkingLevel?: ThinkingLevel;
	focusInput?: string;
	focusText?: string;
	presetQuery?: string;
	attemptId?: string;
	transport?: string;
}

export interface PresetMatchResult {
	kind: 'matched' | 'ambiguous' | 'unmatched';
	name?: string;
	preset?: PresetConfig;
}

export type HookContext = {
	hasUI: boolean;
	ui: Pick<ExtensionUIContext, 'notify' | 'setStatus' | 'setWidget' | 'setWorkingMessage'>;
	model?: Model<Api>;
	cwd?: string | null;
	modelRegistry: {
		getAll(): Model<Api>[];
		getApiKeyAndHeaders(
			model: Model<Api>,
		): Promise<
			{ ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }
		>;
	};
};

export type SummaryProgress = {
	start(modelLabel: string, tokensBefore: number): void;
	update(text: string): void;
	finish(): void;
	fail(message: string): void;
};

export type RunDeps = {
	complete: typeof completeSimple;
	streamSimple: typeof streamSimpleDefault;
	collectFilesTouched: typeof collectFilesTouched;
	loadConfig: typeof loadEffectiveConfig;
	loadCompactionPrompt: typeof loadEffectiveCompactionPromptContract;
	loadBranchSummaryPrompt: typeof loadEffectiveBranchSummaryPromptContract;
	loadCompactionTemplate: typeof loadCompactionTemplate;
	resolvePaths: typeof resolveLiveCompactionPaths;
	fetchTaskState?: () => Promise<string | undefined> | string | undefined;
	appendEntry?: AppendEntry;
	makeProgress?: (ctx: HookContext) => SummaryProgress | undefined;
};
