import type { Message } from '@earendil-works/pi-ai';
import {
	convertToLlm,
	type SessionBeforeTreeEvent,
	serializeConversation,
} from '@earendil-works/pi-coding-agent';

import { DEFAULT_DEPS } from '@live-compaction/compaction';
import { renderFilesTouchedManifestBlock } from '@live-compaction/files-touched';
import {
	buildBranchSummaryRenderVars,
	type CompactionTemplate,
	getBuiltInBranchSummaryTemplate,
} from '@live-compaction/template';
import type { HookContext, NotifyLevel, RunDeps } from '@live-compaction/types';

function notify(ctx: HookContext, message: string, level: NotifyLevel = 'warning'): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	}
}

export async function runGroundedBranchSummaryAugmentation(
	event: SessionBeforeTreeEvent,
	ctx: HookContext,
	deps: RunDeps = DEFAULT_DEPS,
): Promise<{ customInstructions: string; replaceInstructions: boolean } | undefined> {
	if (
		event.signal.aborted ||
		!event.preparation.userWantsSummary ||
		event.preparation.entriesToSummarize.length === 0
	) {
		return undefined;
	}

	try {
		const config = await deps.loadConfig(ctx.cwd);

		const paths = deps.resolvePaths(ctx.cwd);
		const templatePath =
			paths.project?.branchSummaryPromptPath ?? paths.global.branchSummaryPromptPath;
		let template: CompactionTemplate | null = null;
		try {
			template = await deps.loadCompactionTemplate(templatePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			notify(
				ctx,
				`Failed to load branch-summary template ${templatePath}: ${message}. Falling back to built-in.`,
				'warning',
			);
			template = null;
		}

		const filesTouchedBlock = config.includeFilesTouched.inBranchSummary
			? renderFilesTouchedManifestBlock(
					deps.collectFilesTouched(event.preparation.entriesToSummarize, ctx.cwd),
				) || undefined
			: undefined;

		const branchEntryMessages: Message[] = [];
		for (const entry of event.preparation.entriesToSummarize) {
			if (entry.type === 'message') {
				branchEntryMessages.push(entry.message as unknown as Message);
			}
		}
		const branchMessagesText =
			branchEntryMessages.length > 0
				? serializeConversation(convertToLlm(branchEntryMessages))
				: undefined;

		const customFocus = event.preparation.customInstructions || undefined;

		let promptText: string | undefined;
		const renderTemplate = template ?? getBuiltInBranchSummaryTemplate();
		try {
			const vars = buildBranchSummaryRenderVars({
				previousSummary: undefined,
				branchMessagesText,
				filesTouchedBlock,
				customFocus,
				branchEntryMessages,
				frontmatter: renderTemplate.frontmatter,
			});
			promptText = renderTemplate.render(vars as unknown as Record<string, unknown>);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			notify(
				ctx,
				`Branch-summary template render failed (${message}). Falling back to legacy assembly.`,
				'warning',
			);
			promptText = undefined;
		}

		if (!promptText) {
			const promptContract = await deps.loadBranchSummaryPrompt(ctx.cwd);
			if (!promptContract && !filesTouchedBlock && !customFocus) {
				return undefined;
			}
			const sections: string[] = [];
			if (promptContract) sections.push(promptContract);
			if (customFocus) {
				sections.push(`## Additional focus\n\n${customFocus}`);
			}
			if (filesTouchedBlock) {
				sections.push(`## Files touched context\n\n${filesTouchedBlock}`);
			}
			promptText = sections.join('\n\n').trim();
		}

		if (!promptText.trim()) {
			return undefined;
		}

		return {
			customInstructions: promptText.trim(),
			replaceInstructions: true,
		};
	} catch (error) {
		if (event.signal.aborted) return undefined;
		const message = error instanceof Error ? error.message : String(error);
		notify(ctx, `Branch summary augmentation failed: ${message}`, 'warning');
		return undefined;
	}
}
