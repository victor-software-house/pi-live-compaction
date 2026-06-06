import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { runGroundedBranchSummaryAugmentation } from '@live-compaction/branch';
import { registerLiveCompactionCommand } from '@live-compaction/command';
import {
	DEFAULT_DEPS,
	fetchTaskStateSnapshot,
	runLiveCompaction,
} from '@live-compaction/compaction';
import { registerCompactionChatMessage } from '@live-compaction/compaction/chat-message';

// ---------------------------------------------------------------------------
// Re-exports for external consumers
// ---------------------------------------------------------------------------

export { runGroundedBranchSummaryAugmentation } from '@live-compaction/branch';
export {
	fetchTaskStateSnapshot,
	runLiveCompaction,
} from '@live-compaction/compaction';
export type {
	ConfigScope,
	IncludeFilesTouchedSettings,
	LiveCompactionConfig,
	LiveCompactionPaths,
	PresetConfig,
	PromptKind,
	PromptResolution,
	ThinkingLevel,
} from '@live-compaction/config';
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
} from '@live-compaction/config';
export {
	formatManifestOperations,
	renderFilesTouchedManifestBlock,
} from '@live-compaction/files-touched';
export {
	getEffectiveThinkingLevel,
	parseCompactInstructions,
	resolveDefaultSummarizer,
	resolvePresetMatch,
	resolvePresetSummarizer,
} from '@live-compaction/preset';

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default async function liveCompactionExtension(pi: ExtensionAPI): Promise<void> {
	registerLiveCompactionCommand(pi);
	const makeChatProgress = await registerCompactionChatMessage(pi);

	pi.on('session_before_compact', async (event, ctx) => {
		return runLiveCompaction(event, ctx, {
			...DEFAULT_DEPS,
			fetchTaskState: () => fetchTaskStateSnapshot(pi.events),
			appendEntry: pi.appendEntry.bind(pi),
			makeProgress: makeChatProgress,
		});
	});

	pi.on('session_before_tree', async (event, ctx) => {
		return runGroundedBranchSummaryAugmentation(event, ctx);
	});
}
