import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { COMMAND_NAME, getSubcommandCompletions } from '@live-compaction/command/completions';
import { chooseScope, openPanel } from '@live-compaction/command/handlers';
import type { ConfigScope } from '@live-compaction/config';
import { createLiveCompactionController } from '@live-compaction/controller';

export function registerLiveCompactionCommand(pi: ExtensionAPI): void {
	const controller = createLiveCompactionController();

	pi.registerCommand(COMMAND_NAME, {
		description: 'Inspect and configure live compaction',
		getArgumentCompletions: getSubcommandCompletions,
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();

			if (normalized === 'show') {
				const scope: ConfigScope = ctx.cwd ? 'project' : 'global';
				const state = await controller.loadState(ctx, scope);
				ctx.ui.notify(controller.summarizeState(state), 'info');
				return;
			}

			if (normalized === 'verify') {
				const status = await controller.refreshRuntimeStatus(ctx);
				ctx.ui.notify(
					status.available ? 'Grounded compaction verification passed.' : status.issues.join(' | '),
					status.available ? 'info' : 'warning',
				);
				return;
			}

			if (normalized === 'path') {
				const { global, project } = controller.getPaths(ctx);
				ctx.ui.notify(
					project
						? `global: ${global.rootDir} | project: ${project.rootDir}`
						: `global: ${global.rootDir}`,
					'info',
				);
				return;
			}

			if (normalized === 'reset') {
				const scope = ctx.hasUI
					? await chooseScope(ctx, Boolean(ctx.cwd))
					: ctx.cwd
						? 'project'
						: 'global';
				if (!scope) return;
				await controller.resetScope(scope, ctx);
				ctx.ui.notify(`Grounded compaction reset for ${scope} scope.`, 'info');
				return;
			}

			if (normalized === 'help') {
				ctx.ui.notify(controller.getUsageText(), 'info');
				return;
			}

			if (normalized) {
				ctx.ui.notify(controller.getUsageText(), 'warning');
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify(`/${COMMAND_NAME} requires interactive mode.`, 'warning');
				return;
			}

			await openPanel(ctx, controller);
		},
	});
}
