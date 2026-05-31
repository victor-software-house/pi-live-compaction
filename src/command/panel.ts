import { DynamicBorder, type Theme } from '@earendil-works/pi-coding-agent';
import {
	Container,
	type SelectItem,
	SelectList,
	type SettingItem,
	Text,
} from '@earendil-works/pi-tui';
import { ON_OFF_VALUES } from '@live-compaction/command/completions';
import type { PromptKind, PromptResolution } from '@live-compaction/config';
import { CURRENT_PRESET_SENTINEL, PANEL_SCOPE_VALUES } from '@live-compaction/config';
import type { LiveCompactionState } from '@live-compaction/controller';
import {
	buildPresetChoices,
	formatThinkingLevel,
	getPresetNames,
} from '@live-compaction/controller';

export const SETTING_IDS = {
	scope: 'scope',
	defaultScope: 'default-scope',
	inheritSessionModel: 'inherit-session-model',
	compactionFiles: 'compaction-files',
	branchFiles: 'branch-files',
	defaultPreset: 'default-preset',
	presets: 'presets',
	compactionPrompt: 'compaction-prompt',
	branchPrompt: 'branch-prompt',
} as const;

export type PanelExternalAction =
	| { kind: 'preset'; action: 'add' | 'edit' | 'delete' }
	| { kind: 'prompt'; promptKind: PromptKind; action: 'edit' | 'reset' };

// ---------------------------------------------------------------------------
// Describe helpers
// ---------------------------------------------------------------------------

function describeDefaultPanelScope(state: LiveCompactionState): string {
	switch (state.config.defaultPanelScope) {
		case 'global':
			return 'Settings panel opens to the global scope by default.';
		case 'project':
			return 'Settings panel opens to the project scope when one is available, otherwise global.';
	}
}

function describeInheritSessionModel(enabled: boolean): string {
	return enabled
		? "Automatic /compact runs use the current session model + thinking level instead of the configured default preset. Explicit '/compact --preset NAME' and a template 'preset:' frontmatter still win."
		: 'Automatic /compact runs use the configured default preset. Toggle on to inherit the current session model instead.';
}

export function describeScope(state: LiveCompactionState): string {
	if (!state.projectScopeAvailable) {
		return 'Editing global defaults. Project scope is unavailable outside a project session.';
	}
	if (state.scope === 'project') {
		return 'Editing project-local overrides. These take precedence over global defaults for this repo.';
	}
	if (state.projectScopeHasOverrides) {
		return 'Editing global defaults. Project overrides also exist and win inside this repo.';
	}
	return 'Editing global defaults. Switch to project scope to create repo-local overrides.';
}

function describeFilesTouchedSummary(enabled: boolean, kind: 'compaction' | 'branch'): string {
	if (kind === 'compaction') {
		return enabled
			? 'Include the deterministic files-touched manifest in compaction summaries.'
			: 'Do not append the files-touched manifest to compaction summaries.';
	}
	return enabled
		? 'Inject the files-touched manifest into /tree branch-summary instructions.'
		: 'Leave /tree branch summaries ungrounded by the files-touched manifest.';
}

function describeDefaultPreset(state: LiveCompactionState): string {
	if (state.config.defaultPreset === CURRENT_PRESET_SENTINEL) {
		return 'Use the current session model and thinking level for /compact unless --preset overrides it.';
	}
	const preset = state.config.presets[state.config.defaultPreset];
	if (!preset) return 'Selected default preset is missing. Use Enter to choose a valid preset.';
	return `Use ${preset.model} (${formatThinkingLevel(preset.thinkingLevel)}) for /compact unless --preset overrides it.`;
}

function describePresetCollection(state: LiveCompactionState): string {
	const names = getPresetNames(state.config);
	if (names.length === 0)
		return 'No presets configured for this scope. Enter opens add, edit, and delete actions.';
	return `Configured presets: ${names.join(', ')}. Enter opens add, edit, and delete actions.`;
}

function describePromptResolution(kind: PromptKind, prompt: PromptResolution): string {
	if (kind === 'compaction') {
		if (prompt.source === 'default')
			return 'Using the built-in compaction prompt contract. Enter opens edit and reset actions.';
		if (prompt.isBlankOverride)
			return `A blank ${prompt.source} override is present, so compaction falls back to the built-in default contract.`;
		return `Using the ${prompt.source} compaction prompt override. Enter opens edit and reset actions.`;
	}
	if (prompt.source === 'default')
		return "Using Pi's stock branch-summary instructions. Enter opens edit and reset actions.";
	if (prompt.isBlankOverride)
		return `A blank ${prompt.source} override is present, so Pi's stock branch-summary instructions stay active.`;
	return `Using the ${prompt.source} branch-summary prompt override. Enter opens edit and reset actions.`;
}

export function toOnOff(value: boolean): string {
	return value ? 'on' : 'off';
}

export function promptLabel(kind: PromptKind): string {
	return kind === 'compaction' ? 'Compaction prompt' : 'Branch summary prompt';
}

export function promptValue(prompt: PromptResolution): string {
	if (prompt.source === 'default') return 'default';
	if (prompt.isBlankOverride) return `${prompt.source}: blank`;
	return `${prompt.source}: custom`;
}

// ---------------------------------------------------------------------------
// Selection submenu builder
// ---------------------------------------------------------------------------

export function createSelectionSubmenu(
	title: string,
	description: string,
	items: SelectItem[],
	theme: Theme,
	requestRender: () => void,
	done: (selectedValue?: string) => void,
) {
	const container = new Container();
	container.addChild(new DynamicBorder((value: string) => theme.fg('accent', value)));
	container.addChild(new Text(theme.fg('accent', theme.bold(title)), 0, 0));
	container.addChild(new Text(theme.fg('dim', description), 0, 0));
	const selectList = new SelectList(items, 10, {
		selectedPrefix: (text) => theme.fg('accent', text),
		selectedText: (text) => text,
		description: (text) => theme.fg('muted', text),
		scrollInfo: (text) => theme.fg('dim', text),
		noMatch: (text) => theme.fg('warning', text),
	});
	selectList.onSelect = (item) => done(item.value);
	selectList.onCancel = () => done(undefined);
	container.addChild(selectList);
	container.addChild(new Text(theme.fg('dim', 'Enter: select | Esc: back'), 0, 0));
	return {
		render(width: number): string[] {
			return container.render(width);
		},
		invalidate(): void {
			container.invalidate();
		},
		handleInput(data: string): void {
			selectList.handleInput(data);
			requestRender();
		},
	};
}

// ---------------------------------------------------------------------------
// Panel items factory + sync
// ---------------------------------------------------------------------------

export function createPanelItems(
	stateGetter: () => LiveCompactionState,
	theme: Theme,
	requestRender: () => void,
	done: (action?: PanelExternalAction) => void,
): SettingItem[] {
	return [
		{ id: SETTING_IDS.scope, label: 'Scope', description: '', currentValue: 'global' },
		{
			id: SETTING_IDS.defaultScope,
			label: 'Default scope',
			description: '',
			currentValue: 'global',
			values: [...PANEL_SCOPE_VALUES],
		},
		{
			id: SETTING_IDS.inheritSessionModel,
			label: 'Inherit current session model',
			description: '',
			currentValue: 'off',
			values: ON_OFF_VALUES,
		},
		{
			id: SETTING_IDS.compactionFiles,
			label: 'Files touched in compaction',
			description: '',
			currentValue: 'on',
			values: ON_OFF_VALUES,
		},
		{
			id: SETTING_IDS.branchFiles,
			label: 'Files touched in branch summary',
			description: '',
			currentValue: 'on',
			values: ON_OFF_VALUES,
		},
		{
			id: SETTING_IDS.defaultPreset,
			label: 'Default preset',
			description: '',
			currentValue: CURRENT_PRESET_SENTINEL,
			submenu: (_cv, submenuDone) => {
				const state = stateGetter();
				const items = buildPresetChoices(state.config).map((choice) => {
					if (choice === CURRENT_PRESET_SENTINEL) {
						return {
							value: choice,
							label: choice,
							description: 'Use the current session model and thinking level for /compact.',
						};
					}
					const preset = state.config.presets[choice];
					const thinking = preset ? formatThinkingLevel(preset.thinkingLevel) : 'unset';
					return {
						value: choice,
						label: choice,
						description: preset ? `${preset.model} (${thinking})` : 'Preset definition is missing.',
					};
				});
				return createSelectionSubmenu(
					'Default preset',
					'Choose which preset runs /compact by default.',
					items,
					theme,
					requestRender,
					submenuDone,
				);
			},
		},
		{
			id: SETTING_IDS.presets,
			label: 'Preset definitions',
			description: '',
			currentValue: '0 presets',
			submenu: () =>
				createSelectionSubmenu(
					'Preset definitions',
					'Manage named summarizer presets for this scope.',
					[
						{
							value: 'add',
							label: 'Add preset',
							description: 'Create a new named summarizer preset.',
						},
						{
							value: 'edit',
							label: 'Edit preset',
							description: 'Update an existing preset in this scope.',
						},
						{
							value: 'delete',
							label: 'Delete preset',
							description: 'Remove a preset from this scope.',
						},
					],
					theme,
					requestRender,
					(v) => {
						if (v === 'add' || v === 'edit' || v === 'delete') {
							done({ kind: 'preset', action: v });
							return;
						}
						done(undefined);
					},
				),
		},
		{
			id: SETTING_IDS.compactionPrompt,
			label: 'Compaction prompt',
			description: '',
			currentValue: 'default',
			submenu: () =>
				createSelectionSubmenu(
					'Compaction prompt',
					'Edit or reset the scoped compaction prompt override.',
					[
						{
							value: 'edit',
							label: 'Edit prompt',
							description: 'Open the current compaction prompt in the editor.',
						},
						{
							value: 'reset',
							label: 'Reset prompt',
							description: 'Delete the scoped compaction prompt override.',
						},
					],
					theme,
					requestRender,
					(v) => {
						if (v === 'edit' || v === 'reset') {
							done({ kind: 'prompt', promptKind: 'compaction', action: v });
							return;
						}
						done(undefined);
					},
				),
		},
		{
			id: SETTING_IDS.branchPrompt,
			label: 'Branch summary prompt',
			description: '',
			currentValue: 'default',
			submenu: () =>
				createSelectionSubmenu(
					'Branch summary prompt',
					'Edit or reset the scoped branch-summary prompt override.',
					[
						{
							value: 'edit',
							label: 'Edit prompt',
							description: 'Open the current branch-summary prompt in the editor.',
						},
						{
							value: 'reset',
							label: 'Reset prompt',
							description: 'Delete the scoped branch-summary prompt override.',
						},
					],
					theme,
					requestRender,
					(v) => {
						if (v === 'edit' || v === 'reset') {
							done({ kind: 'prompt', promptKind: 'branch-summary', action: v });
							return;
						}
						done(undefined);
					},
				),
		},
	];
}

export function syncPanelItems(items: SettingItem[], state: LiveCompactionState): void {
	for (const item of items) {
		switch (item.id) {
			case SETTING_IDS.scope:
				item.currentValue = state.scope;
				item.description = describeScope(state);
				item.values = state.projectScopeAvailable ? ['global', 'project'] : undefined;
				break;
			case SETTING_IDS.defaultScope:
				item.currentValue = state.config.defaultPanelScope;
				item.description = describeDefaultPanelScope(state);
				item.values = [...PANEL_SCOPE_VALUES];
				break;
			case SETTING_IDS.inheritSessionModel:
				item.currentValue = toOnOff(state.config.inheritSessionModel);
				item.description = describeInheritSessionModel(state.config.inheritSessionModel);
				item.values = ON_OFF_VALUES;
				break;
			case SETTING_IDS.compactionFiles:
				item.currentValue = toOnOff(state.config.includeFilesTouched.inCompactionSummary);
				item.description = describeFilesTouchedSummary(
					state.config.includeFilesTouched.inCompactionSummary,
					'compaction',
				);
				item.values = ON_OFF_VALUES;
				break;
			case SETTING_IDS.branchFiles:
				item.currentValue = toOnOff(state.config.includeFilesTouched.inBranchSummary);
				item.description = describeFilesTouchedSummary(
					state.config.includeFilesTouched.inBranchSummary,
					'branch',
				);
				item.values = ON_OFF_VALUES;
				break;
			case SETTING_IDS.defaultPreset:
				item.currentValue = state.config.defaultPreset;
				item.description = describeDefaultPreset(state);
				break;
			case SETTING_IDS.presets: {
				const presetCount = getPresetNames(state.config).length;
				item.currentValue = presetCount === 1 ? '1 preset' : `${String(presetCount)} presets`;
				item.description = describePresetCollection(state);
				break;
			}
			case SETTING_IDS.compactionPrompt:
				item.currentValue = promptValue(state.compactionPrompt);
				item.description = describePromptResolution('compaction', state.compactionPrompt);
				break;
			case SETTING_IDS.branchPrompt:
				item.currentValue = promptValue(state.branchSummaryPrompt);
				item.description = describePromptResolution('branch-summary', state.branchSummaryPrompt);
				break;
		}
	}
}
