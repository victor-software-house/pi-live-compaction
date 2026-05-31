/**
 * Liquid-based template engine for live compaction prompts.
 *
 * Shared Liquid mechanics (engine defaults, filters, `{% xml %}`, and
 * template loading) live in `pi-template-kit`. This module keeps only
 * live-compaction-specific frontmatter normalization, error type,
 * and render-variable builders.
 *
 * File layout convention (per scope; project overrides global):
 *
 *   extensions/live-compaction/
 *     compaction-prompt.md           required template
 *     branch-summary-prompt.md       optional template
 *     templates/                     optional partials, layouts, etc.
 *
 * Partials and layouts resolve from <templateDir>/templates/ first, then
 * <templateDir>/. Use `{% include 'name' %}` and `{% layout 'name' %}` —
 * Liquid does the rest.
 */

import type { Message } from '@earendil-works/pi-ai';
import {
	loadTemplate,
	loadTemplateFromString,
	TemplateKitError,
	type LoadedTemplate,
} from 'pi-template-kit/template';

import { normalizeThinkingLevel } from './config';
import type {
	BranchSummaryRenderVars,
	CompactionRenderVars,
	CompactionTemplateFrontmatter,
} from './template-types';

export type {
	BranchSummaryRenderVars,
	CompactionRenderVars,
	CompactionTemplateFrontmatter,
} from './template-types';

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: unknown): CompactionTemplateFrontmatter {
	if (!raw || typeof raw !== 'object') {
		return { extra: {} };
	}
	const data = raw as Record<string, unknown>;
	const fm: CompactionTemplateFrontmatter = { extra: {} };

	if (typeof data.preset === 'string' && data.preset.trim()) {
		fm.preset = data.preset.trim();
	}
	if (data.thinkingLevel !== undefined || data.thinking_level !== undefined) {
		const candidate = data.thinkingLevel ?? data.thinking_level;
		const normalized = normalizeThinkingLevel(candidate);
		if (normalized) fm.thinkingLevel = normalized;
	}
	if (typeof data.model === 'string' && data.model.trim()) {
		fm.model = data.model.trim();
	}
	if (typeof data.description === 'string') {
		fm.description = data.description;
	}

	for (const [k, v] of Object.entries(data)) {
		if (
			k === 'preset' ||
			k === 'thinkingLevel' ||
			k === 'thinking_level' ||
			k === 'model' ||
			k === 'description'
		) {
			continue;
		}
		fm.extra[k] = v;
	}

	return fm;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compiled liquid template. Render accepts any record because the same
 * engine is reused for compaction and branch-summary, which expose
 * different variable shapes. Specific call sites use
 * `buildRenderVars` / `buildBranchSummaryRenderVars` for type-safety.
 */
export interface CompactionTemplate {
	templatePath: string;
	frontmatter: CompactionTemplateFrontmatter;
	render(vars: Record<string, unknown> | CompactionRenderVars | BranchSummaryRenderVars): string;
}

export class CompactionTemplateError extends Error {
	// Explicit field declaration instead of a parameter property
	// (`constructor(public readonly x)`) so the file stays loadable under
	// Node’s strip-mode TypeScript loader — which is what pi runs under
	// by default (no `--import tsx`). Strip mode rejects parameter
	// properties at parse time.
	readonly templatePath: string;

	constructor(message: string, templatePath: string) {
		super(message);
		this.name = 'CompactionTemplateError';
		this.templatePath = templatePath;
	}
}

function asCompactionTemplate(loaded: LoadedTemplate<Record<string, unknown>>): CompactionTemplate {
	return {
		templatePath: loaded.templatePath,
		frontmatter: loaded.frontmatter as unknown as CompactionTemplateFrontmatter,
		render(vars: Record<string, unknown> | CompactionRenderVars | BranchSummaryRenderVars): string {
			try {
				return loaded.render(vars as Record<string, unknown>);
			} catch (error) {
				throw toCompactionTemplateError(error, loaded.templatePath);
			}
		},
	};
}

function toCompactionTemplateError(
	error: unknown,
	fallbackTemplatePath: string,
): CompactionTemplateError {
	if (error instanceof CompactionTemplateError) return error;
	const templatePath =
		error instanceof TemplateKitError ? error.templatePath : fallbackTemplatePath;
	const message = error instanceof Error ? error.message : String(error);
	return new CompactionTemplateError(message, templatePath);
}

export async function loadCompactionTemplate(
	templatePath: string,
): Promise<CompactionTemplate | null> {
	try {
		return asCompactionTemplate(
			await loadTemplate(templatePath, {
				parseFrontmatter: (raw) => parseFrontmatter(raw) as unknown as Record<string, unknown>,
			}),
		);
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === 'ENOENT') return null;
		throw toCompactionTemplateError(error, templatePath);
	}
}

/**
 * Compile a template from an in-memory string instead of reading a file.
 *
 * Used by the built-in fallback templates so the runtime renders them
 * through exactly the same engine as on-disk ones. `templatePath` is
 * still required so error messages can name the source, and `templateDir`
 * controls partial / layout resolution — pass a real directory if you
 * want sibling partials to resolve, or a synthetic path (no directory
 * read) otherwise.
 */
export function loadCompactionTemplateFromString(
	body: string,
	options: { templatePath: string; templateDir: string },
): CompactionTemplate {
	try {
		return asCompactionTemplate(
			loadTemplateFromString(body, {
				...options,
				parseFrontmatter: (raw) => parseFrontmatter(raw) as unknown as Record<string, unknown>,
			}),
		);
	} catch (error) {
		throw toCompactionTemplateError(error, options.templatePath);
	}
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Convenience: build CompactionRenderVars from spans
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
