import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { runGroundedBranchSummaryAugmentation } from '@live-compaction/branch-handler';
import { registerLiveCompactionCommand } from '@live-compaction/command';
import {
	DEFAULT_DEPS,
	fetchTaskStateSnapshot,
	runLiveCompaction,
} from '@live-compaction/compaction-handler';

// ---------------------------------------------------------------------------
// Re-exports for external consumers
// ---------------------------------------------------------------------------

export { runGroundedBranchSummaryAugmentation } from '@live-compaction/branch-handler';
export {
	fetchTaskStateSnapshot,
	runLiveCompaction,
} from '@live-compaction/compaction-handler';
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
} from '@live-compaction/files-touched-manifest';
export { parseCompactInstructions, resolvePresetMatch } from '@live-compaction/preset';
export {
	getEffectiveThinkingLevel,
	resolveDefaultSummarizer,
	resolvePresetSummarizer,
} from '@live-compaction/summarizer';

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
