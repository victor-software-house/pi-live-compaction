export type { CompactionTemplate } from '@live-compaction/template/loader';
export {
	CompactionTemplateError,
	getBuiltInBranchSummaryTemplate,
	getBuiltInCompactionTemplate,
	loadCompactionTemplate,
	loadCompactionTemplateFromString,
} from '@live-compaction/template/loader';
export type {
	BuildBranchSummaryRenderVarsOptions,
	BuildRenderVarsOptions,
} from '@live-compaction/template/render-vars';
export {
	buildBranchSummaryRenderVars,
	buildRenderVars,
} from '@live-compaction/template/render-vars';
export type {
	BranchSummaryRenderVars,
	CompactionRenderVars,
	CompactionTemplateFrontmatter,
} from '@live-compaction/template/types';
