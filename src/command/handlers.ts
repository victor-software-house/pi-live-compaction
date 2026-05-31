import {
	DynamicBorder,
	type ExtensionCommandContext,
	getSettingsListTheme,
	type Theme,
} from '@earendil-works/pi-coding-agent';
import { Container, type SettingItem, SettingsList, Text } from '@earendil-works/pi-tui';
import { THINKING_LEVEL_VALUES } from '@live-compaction/command/completions';
import {
	createPanelItems,
	type PanelExternalAction,
	promptLabel,
	SETTING_IDS,
	syncPanelItems,
} from '@live-compaction/command/panel';
import type { ConfigScope, PresetConfig, PromptKind } from '@live-compaction/config';
import { loadEffectiveConfig } from '@live-compaction/config';
import type { LiveCompactionController, LiveCompactionState } from '@live-compaction/controller';
import { getPresetNames, parseThinkingLevelSelection } from '@live-compaction/controller';

// ---------------------------------------------------------------------------
// Simple helpers
// ---------------------------------------------------------------------------

export async function chooseScope(
	ctx: ExtensionCommandContext,
	allowProject: boolean,
): Promise<ConfigScope | undefined> {
	if (!allowProject) return 'global';
	const result = await ctx.ui.select('Choose scope', ['global', 'project']);
	if (result === 'global' || result === 'project') return result;
	return undefined;
}

export async function promptForPreset(
	ctx: ExtensionCommandContext,
	name: string,
	current?: PresetConfig,
): Promise<PresetConfig | undefined> {
	const model = await ctx.ui.input(
		`${name}: provider/modelId`,
		current?.model ?? 'anthropic/claude-sonnet-4',
	);
	const normalizedModel = model?.trim();
	if (!normalizedModel) return undefined;
	const thinkingSelection = await ctx.ui.select(`${name}: thinking level`, [
		...THINKING_LEVEL_VALUES,
	]);
	if (!thinkingSelection) return undefined;
	return {
		model: normalizedModel,
		thinkingLevel: parseThinkingLevelSelection(thinkingSelection),
	};
}

// ---------------------------------------------------------------------------
// Prompt handlers
// ---------------------------------------------------------------------------

export async function editPrompt(
	kind: PromptKind,
	scope: ConfigScope,
	ctx: ExtensionCommandContext,
	controller: LiveCompactionController,
): Promise<void> {
	const state = await controller.loadState(ctx, scope);
	const currentText =
		kind === 'compaction' ? state.compactionPrompt.text : state.branchSummaryPrompt.text;
	const edited = await ctx.ui.editor(`${promptLabel(kind)} (${scope})`, currentText);
	if (edited === undefined) return;
	await controller.savePrompt(scope, kind, edited, ctx);
	ctx.ui.notify(`${promptLabel(kind)} saved for ${scope} scope.`, 'info');
}

export async function resetPrompt(
	kind: PromptKind,
	scope: ConfigScope,
	ctx: ExtensionCommandContext,
	controller: LiveCompactionController,
): Promise<void> {
	const confirmed = await ctx.ui.confirm(
		`Reset ${promptLabel(kind)}`,
		`Remove the ${scope} ${promptLabel(kind).toLowerCase()} override?`,
	);
	if (!confirmed) return;
	await controller.resetPrompt(scope, kind, ctx);
	ctx.ui.notify(`${promptLabel(kind)} reset for ${scope} scope.`, 'info');
}

// ---------------------------------------------------------------------------
// Preset management
// ---------------------------------------------------------------------------

export async function managePreset(
	action: PanelExternalAction['action'],
	scope: ConfigScope,
	ctx: ExtensionCommandContext,
	controller: LiveCompactionController,
): Promise<void> {
	const state = await controller.loadState(ctx, scope);
	const presetNames = getPresetNames(state.config);

	if (action === 'add') {
		const name = await ctx.ui.input('Preset name', 'fast');
		const normalizedName = name?.trim();
		if (!normalizedName) return;
		const preset = await promptForPreset(ctx, normalizedName);
		if (!preset) return;
		await controller.upsertPreset(scope, normalizedName, preset, ctx);
		ctx.ui.notify(`Preset '${normalizedName}' saved for ${scope} scope.`, 'info');
		return;
	}

	if (presetNames.length === 0) {
		ctx.ui.notify(`No presets are defined for ${scope} scope.`, 'warning');
		return;
	}

	const title = action === 'edit' ? `Edit preset (${scope})` : `Delete preset (${scope})`;
	const presetName = await ctx.ui.select(title, presetNames);
	if (!presetName) return;

	if (action === 'edit') {
		const preset = await promptForPreset(ctx, presetName, state.config.presets[presetName]);
		if (!preset) return;
		await controller.upsertPreset(scope, presetName, preset, ctx);
		ctx.ui.notify(`Preset '${presetName}' updated for ${scope} scope.`, 'info');
		return;
	}

	const confirmed = await ctx.ui.confirm(
		'Delete preset',
		`Delete preset '${presetName}' from ${scope} scope?`,
	);
	if (!confirmed) return;
	await controller.deletePreset(scope, presetName, ctx);
	ctx.ui.notify(`Preset '${presetName}' deleted from ${scope} scope.`, 'info');
}

// ---------------------------------------------------------------------------
// Scope picker
// ---------------------------------------------------------------------------

export async function pickInitialScope(ctx: ExtensionCommandContext): Promise<ConfigScope> {
	try {
		const effective = await loadEffectiveConfig(ctx.cwd);
		const preference = effective.defaultPanelScope;
		if (preference === 'project' && ctx.cwd) return 'project';
		return 'global';
	} catch {
		return 'global';
	}
}

// ---------------------------------------------------------------------------
// Main settings panel
// ---------------------------------------------------------------------------

function buildSettingsList(
	items: SettingItem[],
	_scope: string,
	_state: LiveCompactionState,
	controller: LiveCompactionController,
	ctx: ExtensionCommandContext,
	getScope: () => ConfigScope,
	setScope: (s: ConfigScope) => void,
	refreshState: () => Promise<void>,
	done: (action?: PanelExternalAction) => void,
	_theme: Theme,
	_tui: { requestRender(): void },
): SettingsList {
	return new SettingsList(
		items,
		12,
		getSettingsListTheme(),
		async (id, newValue) => {
			if (id === SETTING_IDS.scope) {
				if (newValue === 'global' || newValue === 'project') {
					setScope(newValue);
					await refreshState();
				}
				return;
			}
			if (id === SETTING_IDS.defaultScope) {
				if (newValue === 'global' || newValue === 'project') {
					const currentState = await controller.loadState(ctx, getScope());
					await controller.setConfig(
						getScope(),
						{ ...currentState.config, defaultPanelScope: newValue },
						ctx,
					);
					await refreshState();
				}
				return;
			}
			if (id === SETTING_IDS.inheritSessionModel) {
				const currentState = await controller.loadState(ctx, getScope());
				await controller.setConfig(
					getScope(),
					{ ...currentState.config, inheritSessionModel: newValue === 'on' },
					ctx,
				);
				await refreshState();
				return;
			}
			if (id === SETTING_IDS.compactionFiles || id === SETTING_IDS.branchFiles) {
				const currentState = await controller.loadState(ctx, getScope());
				const next = {
					...currentState.config,
					includeFilesTouched: {
						...currentState.config.includeFilesTouched,
						...(id === SETTING_IDS.compactionFiles
							? { inCompactionSummary: newValue === 'on' }
							: { inBranchSummary: newValue === 'on' }),
					},
				};
				await controller.setConfig(getScope(), next, ctx);
				await refreshState();
				return;
			}
			if (id === SETTING_IDS.defaultPreset) {
				const currentState = await controller.loadState(ctx, getScope());
				await controller.setConfig(
					getScope(),
					{ ...currentState.config, defaultPreset: newValue },
					ctx,
				);
				await refreshState();
			}
		},
		() => done(undefined),
		{ enableSearch: true },
	);
}

export async function openPanel(
	ctx: ExtensionCommandContext,
	controller: LiveCompactionController,
): Promise<void> {
	let scope: ConfigScope = await pickInitialScope(ctx);

	while (true) {
		let state = await controller.loadState(ctx, scope);
		const action = await ctx.ui.custom<PanelExternalAction | undefined>((tui, theme, _kb, done) => {
			const items = createPanelItems(
				() => state,
				theme,
				() => tui.requestRender(),
				done,
			);
			syncPanelItems(items, state);

			const container = new Container();
			container.addChild(new DynamicBorder((value: string) => theme.fg('accent', value)));
			container.addChild(new Text(theme.fg('accent', theme.bold('Grounded Compaction')), 0, 0));
			container.addChild(new Text(theme.fg('dim', controller.summarizeState(state)), 0, 0));

			let settingsList: SettingsList | null = null;
			const refreshState = async (): Promise<void> => {
				state = await controller.loadState(ctx, scope);
				syncPanelItems(items, state);
				settingsList?.invalidate();
				container.invalidate();
				tui.requestRender();
			};

			settingsList = buildSettingsList(
				items,
				scope,
				state,
				controller,
				ctx,
				() => scope,
				(s) => {
					scope = s;
				},
				refreshState,
				done,
				theme,
				tui,
			);

			container.addChild(settingsList);
			container.addChild(
				new Text(theme.fg('dim', '/live-compaction show • verify • path • reset'), 0),
			);

			return {
				render(width: number): string[] {
					return container.render(width);
				},
				invalidate(): void {
					container.invalidate();
				},
				handleInput(data: string): void {
					settingsList?.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!action) return;

		if (action.kind === 'preset') {
			await managePreset(action.action, scope, ctx, controller);
			continue;
		}

		if (action.action === 'edit') {
			await editPrompt(action.promptKind, scope, ctx, controller);
			continue;
		}

		await resetPrompt(action.promptKind, scope, ctx, controller);
	}
}
