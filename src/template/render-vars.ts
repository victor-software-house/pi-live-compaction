import type { Message } from '@earendil-works/pi-ai';

import type {
	BranchSummaryRenderVars,
	CompactionRenderVars,
	CompactionTemplateFrontmatter,
} from '@live-compaction/template/types';

function isMessage(value: unknown): value is Message {
	return (
		typeof value === 'object' && value !== null && 'role' in (value as Record<string, unknown>)
	);
}

function extractMessageText(value: unknown): string {
	if (!isMessage(value)) return '';
	const content = (value as { content?: unknown }).content;
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	const parts: string[] = [];
	for (const block of content) {
		if (
			block &&
			typeof block === 'object' &&
			(block as { type?: string }).type === 'text' &&
			typeof (block as { text?: string }).text === 'string'
		) {
			parts.push((block as { text: string }).text);
		}
	}
	return parts.join('\n');
}

function findLastUserText(groups: Message[][]): string | undefined {
	for (const group of groups) {
		for (let i = group.length - 1; i >= 0; i--) {
			const m = group[i];
			if (m.role === 'user') {
				const text = extractMessageText(m);
				if (text) return text;
			}
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Compaction render vars
// ---------------------------------------------------------------------------

export interface BuildRenderVarsOptions {
	previousSummary?: string;
	discardedText?: string;
	keptTailText?: string;
	taskStateBlock?: string;
	filesTouchedBlock?: string;
	focusText?: string;
	focusInput?: string;
	discardedMessages: Message[];
	keptTailMessages: Message[];
	frontmatter?: CompactionTemplateFrontmatter;
}

export function buildRenderVars(options: BuildRenderVarsOptions): CompactionRenderVars {
	const lastUserMessage = findLastUserText([options.keptTailMessages, options.discardedMessages]);

	return {
		previous_summary: options.previousSummary,
		discarded: options.discardedText,
		kept_tail: options.keptTailText,
		task_state: options.taskStateBlock,
		files_touched: options.filesTouchedBlock,
		focus: options.focusText,
		focus_input: options.focusInput,
		discarded_messages: options.discardedMessages,
		kept_tail_messages: options.keptTailMessages,
		last_user_message: lastUserMessage,
		stats: {
			discarded_messages: options.discardedMessages.length,
			kept_tail_messages: options.keptTailMessages.length,
			discarded_chars: options.discardedText?.length ?? 0,
			kept_tail_chars: options.keptTailText?.length ?? 0,
			task_state_chars: options.taskStateBlock?.length ?? 0,
		},
		meta: options.frontmatter ?? { extra: {} },
	};
}

// ---------------------------------------------------------------------------
// Branch-summary render vars
// ---------------------------------------------------------------------------

export interface BuildBranchSummaryRenderVarsOptions {
	previousSummary?: string;
	branchMessagesText?: string;
	filesTouchedBlock?: string;
	customFocus?: string;
	branchEntryMessages: Message[];
	frontmatter?: CompactionTemplateFrontmatter;
}

export function buildBranchSummaryRenderVars(
	options: BuildBranchSummaryRenderVarsOptions,
): BranchSummaryRenderVars {
	const lastUserMessage = findLastUserText([options.branchEntryMessages]);
	return {
		previous_summary: options.previousSummary,
		branch_messages: options.branchMessagesText,
		files_touched: options.filesTouchedBlock,
		custom_focus: options.customFocus,
		branch_entry_messages: options.branchEntryMessages,
		last_user_message: lastUserMessage,
		stats: {
			branch_messages: options.branchEntryMessages.length,
			branch_chars: options.branchMessagesText?.length ?? 0,
		},
		meta: options.frontmatter ?? { extra: {} },
	};
}
