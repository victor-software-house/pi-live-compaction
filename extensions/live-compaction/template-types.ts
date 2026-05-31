/**
 * Shared types for compaction templates.
 *
 * Living in their own module so other modules can import them without
 * pulling the `pi-template-kit` runtime from `template.ts`.
 */

import type { Message } from "@earendil-works/pi-ai";

import type { ThinkingLevel } from "./config";

export interface CompactionTemplateFrontmatter {
	preset?: string;
	thinkingLevel?: ThinkingLevel;
	model?: string;
	description?: string;
	/** Anything else the template author wrote — passed through to renders. */
	extra: Record<string, unknown>;
}

/**
 * Variables exposed to every template render.
 *
 * Pre-serialized strings let the template splice spans in directly with
 * `{{ kept_tail }}`. Raw `Message[]` arrays are also exposed so templates
 * can transform them with Liquid built-ins (`where`, `map`, `slice`, …)
 * or our small custom-helper set when richer access is needed.
 */
export interface CompactionRenderVars {
	previous_summary?: string;
	discarded?: string;
	kept_tail?: string;
	task_state?: string;
	files_touched?: string;
	focus?: string;
	focus_input?: string;
	discarded_messages: Message[];
	kept_tail_messages: Message[];
	last_user_message?: string;
	stats: {
		discarded_messages: number;
		kept_tail_messages: number;
		discarded_chars: number;
		kept_tail_chars: number;
		task_state_chars: number;
	};
	meta: CompactionTemplateFrontmatter;
}

/**
 * Variables exposed to a branch-summary template render.
 *
 * Branch summaries don't see the full discarded/kept-tail split; they
 * see the active branch entries serialized as `branch_messages` plus an
 * optional files-touched manifest. `custom_focus` carries any extra
 * user-supplied focus string from the /tree invocation.
 */
export interface BranchSummaryRenderVars {
	previous_summary?: string;
	branch_messages?: string;
	files_touched?: string;
	custom_focus?: string;
	branch_entry_messages: Message[];
	last_user_message?: string;
	stats: {
		branch_messages: number;
		branch_chars: number;
	};
	meta: CompactionTemplateFrontmatter;
}
