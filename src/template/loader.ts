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

import {
	DEFAULT_BRANCH_SUMMARY_TEMPLATE_BODY,
	DEFAULT_COMPACTION_TEMPLATE_BODY,
	normalizeThinkingLevel,
} from '@live-compaction/config';
import type {
	BranchSummaryRenderVars,
	CompactionRenderVars,
	CompactionTemplateFrontmatter,
} from '@live-compaction/template/types';
import {
	type LoadedTemplate,
	loadTemplate,
	loadTemplateFromString,
	TemplateKitError,
} from 'pi-template-kit/template';

export type {
	BranchSummaryRenderVars,
	CompactionRenderVars,
	CompactionTemplateFrontmatter,
} from '@live-compaction/template/types';

// ---------------------------------------------------------------------------
// Frontmatter parser
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
	// Node's strip-mode TypeScript loader — which is what pi runs under
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
// Built-in template singletons (lazy, reused across calls)
// ---------------------------------------------------------------------------

let builtInCompactionTemplate: CompactionTemplate | null = null;

/**
 * Built-in compaction template compiled once and reused for every
 * fallback render. The body lives in config/prompts.ts so it can also be
 * inspected by tests and the preview CLI without going through this module.
 */
export function getBuiltInCompactionTemplate(): CompactionTemplate {
	if (!builtInCompactionTemplate) {
		builtInCompactionTemplate = loadCompactionTemplateFromString(DEFAULT_COMPACTION_TEMPLATE_BODY, {
			templatePath: '<built-in compaction template>',
			templateDir: '/',
		});
	}
	return builtInCompactionTemplate;
}

let builtInBranchSummaryTemplate: CompactionTemplate | null = null;

export function getBuiltInBranchSummaryTemplate(): CompactionTemplate {
	if (!builtInBranchSummaryTemplate) {
		builtInBranchSummaryTemplate = loadCompactionTemplateFromString(
			DEFAULT_BRANCH_SUMMARY_TEMPLATE_BODY,
			{
				templatePath: '<built-in branch summary template>',
				templateDir: '/',
			},
		);
	}
	return builtInBranchSummaryTemplate;
}
