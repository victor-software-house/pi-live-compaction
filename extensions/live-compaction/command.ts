import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getSettingsListTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	Container,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";

import type {
	ConfigScope,
	PanelScope,
	PresetConfig,
	PromptKind,
	PromptResolution,
} from "./config";
import {
	CURRENT_PRESET_SENTINEL,
	loadEffectiveConfig,
	PANEL_SCOPE_VALUES,
} from "./config";
import type {
	LiveCompactionController,
	LiveCompactionState,
} from "./controller";
import {
	buildPresetChoices,
	createLiveCompactionController,
	formatThinkingLevel,
	getPresetNames,
	parseThinkingLevelSelection,
} from "./controller";

const COMMAND_NAME = "live-compaction";
const SUBCOMMANDS = ["show", "verify", "path", "reset", "help"];
const ON_OFF_VALUES = ["off", "on"];
const THINKING_LEVEL_VALUES = [
	"unset",
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

const SETTING_IDS = {
	scope: "scope",
	defaultScope: "default-scope",
	inheritSessionModel: "inherit-session-model",
	compactionFiles: "compaction-files",
	branchFiles: "branch-files",
	defaultPreset: "default-preset",
	presets: "presets",
	compactionPrompt: "compaction-prompt",
	branchPrompt: "branch-prompt",
} as const;

function describeDefaultPanelScope(state: LiveCompactionState): string {
	switch (state.config.defaultPanelScope) {
		case "global":
			return "Settings panel opens to the global scope by default.";
		case "project":
			return "Settings panel opens to the project scope when one is available, otherwise global.";
	}
}

function describeInheritSessionModel(enabled: boolean): string {
	return enabled
		? "Automatic /compact runs use the current session model + thinking level instead of the configured default preset. Explicit '/compact --preset NAME' and a template 'preset:' frontmatter still win."
		: "Automatic /compact runs use the configured default preset. Toggle on to inherit the current session model instead.";
}

type PanelExternalAction =
	| { kind: "preset"; action: "add" | "edit" | "delete" }
	| { kind: "prompt"; promptKind: PromptKind; action: "edit" | "reset" };

function getSubcommandCompletions(prefix: string): AutocompleteItem[] | null {
	const trimmed = prefix.trimStart();
	const matches = SUBCOMMANDS.filter((value) => value.startsWith(trimmed));
	return matches.length > 0
		? matches.map((value) => ({ value, label: value }))
		: null;
}

function toOnOff(value: boolean): string {
	return value ? "on" : "off";
}

function promptLabel(kind: PromptKind): string {
	return kind === "compaction" ? "Compaction prompt" : "Branch summary prompt";
}

function promptValue(prompt: PromptResolution): string {
	if (prompt.source === "default") {
		return "default";
	}

	if (prompt.isBlankOverride) {
		return `${prompt.source}: blank`;
	}

	return `${prompt.source}: custom`;
}

function describeScope(state: LiveCompactionState): string {
	if (!state.projectScopeAvailable) {
		return "Editing global defaults. Project scope is unavailable outside a project session.";
	}

	if (state.scope === "project") {
		return "Editing project-local overrides. These take precedence over global defaults for this repo.";
	}

	if (state.projectScopeHasOverrides) {
		return "Editing global defaults. Project overrides also exist and win inside this repo.";
	}

	return "Editing global defaults. Switch to project scope to create repo-local overrides.";
}

function describeFilesTouchedSummary(
	enabled: boolean,
	kind: "compaction" | "branch",
): string {
	if (kind === "compaction") {
		return enabled
			? "Include the deterministic files-touched manifest in compaction summaries."
			: "Do not append the files-touched manifest to compaction summaries.";
	}

	return enabled
		? "Inject the files-touched manifest into /tree branch-summary instructions."
		: "Leave /tree branch summaries ungrounded by the files-touched manifest.";
}

function describeDefaultPreset(state: LiveCompactionState): string {
	if (state.config.defaultPreset === CURRENT_PRESET_SENTINEL) {
		return "Use the current session model and thinking level for /compact unless --preset overrides it.";
	}

	const preset = state.config.presets[state.config.defaultPreset];
	if (!preset) {
		return "Selected default preset is missing. Use Enter to choose a valid preset.";
	}

	const thinking = formatThinkingLevel(preset.thinkingLevel);
	return `Use ${preset.model} (${thinking}) for /compact unless --preset overrides it.`;
}

function describePresetCollection(state: LiveCompactionState): string {
	const presetNames = getPresetNames(state.config);
	if (presetNames.length === 0) {
		return "No presets configured for this scope. Enter opens add, edit, and delete actions.";
	}

	return `Configured presets: ${presetNames.join(", ")}. Enter opens add, edit, and delete actions.`;
}

function describePromptResolution(
	kind: PromptKind,
	prompt: PromptResolution,
): string {
	if (kind === "compaction") {
		if (prompt.source === "default") {
			return "Using the built-in compaction prompt contract. Enter opens edit and reset actions.";
		}

		if (prompt.isBlankOverride) {
			return `A blank ${prompt.source} override is present, so compaction falls back to the built-in default contract.`;
		}

		return `Using the ${prompt.source} compaction prompt override. Enter opens edit and reset actions.`;
	}

	if (prompt.source === "default") {
		return "Using Pi's stock branch-summary instructions. Enter opens edit and reset actions.";
	}

	if (prompt.isBlankOverride) {
		return `A blank ${prompt.source} override is present, so Pi's stock branch-summary instructions stay active.`;
	}

	return `Using the ${prompt.source} branch-summary prompt override. Enter opens edit and reset actions.`;
}

function createSelectionSubmenu(
	title: string,
	description: string,
	items: SelectItem[],
	theme: Theme,
	requestRender: () => void,
	done: (selectedValue?: string) => void,
) {
	const container = new Container();
	container.addChild(
		new DynamicBorder((value: string) => theme.fg("accent", value)),
	);
	container.addChild(new Text(theme.fg("accent", theme.bold(title)), 0, 0));
	container.addChild(new Text(theme.fg("dim", description), 0, 0));

	const selectList = new SelectList(items, 10, {
		selectedPrefix: (text) => theme.fg("accent", text),
		selectedText: (text) => text,
		description: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("dim", text),
		noMatch: (text) => theme.fg("warning", text),
	});

	selectList.onSelect = (item) => done(item.value);
	selectList.onCancel = () => done(undefined);
	container.addChild(selectList);
	container.addChild(
		new Text(theme.fg("dim", "Enter: select | Esc: back"), 0, 0),
	);

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

function createPanelItems(
	stateGetter: () => LiveCompactionState,
	theme: Theme,
	requestRender: () => void,
	done: (action?: PanelExternalAction) => void,
): SettingItem[] {
	return [
		{
			id: SETTING_IDS.scope,
			label: "Scope",
			description: "",
			currentValue: "global",
		},
		{
			id: SETTING_IDS.defaultScope,
			label: "Default scope",
			description: "",
			currentValue: "global",
			values: [...PANEL_SCOPE_VALUES],
		},
		{
			id: SETTING_IDS.inheritSessionModel,
			label: "Inherit current session model",
			description: "",
			currentValue: "off",
			values: ON_OFF_VALUES,
		},
		{
			id: SETTING_IDS.compactionFiles,
			label: "Files touched in compaction",
			description: "",
			currentValue: "on",
			values: ON_OFF_VALUES,
		},
		{
			id: SETTING_IDS.branchFiles,
			label: "Files touched in branch summary",
			description: "",
			currentValue: "on",
			values: ON_OFF_VALUES,
		},
		{
			id: SETTING_IDS.defaultPreset,
			label: "Default preset",
			description: "",
			currentValue: CURRENT_PRESET_SENTINEL,
			submenu: (_currentValue, submenuDone) => {
				const state = stateGetter();
				const items = buildPresetChoices(state.config).map((choice) => {
					if (choice === CURRENT_PRESET_SENTINEL) {
						return {
							value: choice,
							label: choice,
							description:
								"Use the current session model and thinking level for /compact.",
						};
					}

					const preset = state.config.presets[choice];
					const thinking = preset
						? formatThinkingLevel(preset.thinkingLevel)
						: "unset";
					return {
						value: choice,
						label: choice,
						description: preset
							? `${preset.model} (${thinking})`
							: "Preset definition is missing.",
					};
				});

				return createSelectionSubmenu(
					"Default preset",
					"Choose which preset runs /compact by default.",
					items,
					theme,
					requestRender,
					submenuDone,
				);
			},
		},
		{
			id: SETTING_IDS.presets,
			label: "Preset definitions",
			description: "",
			currentValue: "0 presets",
			submenu: () =>
				createSelectionSubmenu(
					"Preset definitions",
					"Manage named summarizer presets for this scope.",
					[
						{
							value: "add",
							label: "Add preset",
							description: "Create a new named summarizer preset.",
						},
						{
							value: "edit",
							label: "Edit preset",
							description: "Update an existing preset in this scope.",
						},
						{
							value: "delete",
							label: "Delete preset",
							description: "Remove a preset from this scope.",
						},
					],
					theme,
					requestRender,
					(selectedValue) => {
						if (
							selectedValue === "add" ||
							selectedValue === "edit" ||
							selectedValue === "delete"
						) {
							done({ kind: "preset", action: selectedValue });
							return;
						}

						done(undefined);
					},
				),
		},
		{
			id: SETTING_IDS.compactionPrompt,
			label: "Compaction prompt",
			description: "",
			currentValue: "default",
			submenu: () =>
				createSelectionSubmenu(
					"Compaction prompt",
					"Edit or reset the scoped compaction prompt override.",
					[
						{
							value: "edit",
							label: "Edit prompt",
							description: "Open the current compaction prompt in the editor.",
						},
						{
							value: "reset",
							label: "Reset prompt",
							description: "Delete the scoped compaction prompt override.",
						},
					],
					theme,
					requestRender,
					(selectedValue) => {
						if (selectedValue === "edit" || selectedValue === "reset") {
							done({
								kind: "prompt",
								promptKind: "compaction",
								action: selectedValue,
							});
							return;
						}

						done(undefined);
					},
				),
		},
		{
			id: SETTING_IDS.branchPrompt,
			label: "Branch summary prompt",
			description: "",
			currentValue: "default",
			submenu: () =>
				createSelectionSubmenu(
					"Branch summary prompt",
					"Edit or reset the scoped branch-summary prompt override.",
					[
						{
							value: "edit",
							label: "Edit prompt",
							description:
								"Open the current branch-summary prompt in the editor.",
						},
						{
							value: "reset",
							label: "Reset prompt",
							description: "Delete the scoped branch-summary prompt override.",
						},
					],
					theme,
					requestRender,
					(selectedValue) => {
						if (selectedValue === "edit" || selectedValue === "reset") {
							done({
								kind: "prompt",
								promptKind: "branch-summary",
								action: selectedValue,
							});
							return;
						}

						done(undefined);
					},
				),
		},
	];
}

function syncPanelItems(
	items: SettingItem[],
	state: LiveCompactionState,
): void {
	for (const item of items) {
		switch (item.id) {
			case SETTING_IDS.scope:
				item.currentValue = state.scope;
				item.description = describeScope(state);
				item.values = state.projectScopeAvailable
					? ["global", "project"]
					: undefined;
				break;
			case SETTING_IDS.defaultScope:
				item.currentValue = state.config.defaultPanelScope;
				item.description = describeDefaultPanelScope(state);
				item.values = [...PANEL_SCOPE_VALUES];
				break;
			case SETTING_IDS.inheritSessionModel:
				item.currentValue = toOnOff(state.config.inheritSessionModel);
				item.description = describeInheritSessionModel(
					state.config.inheritSessionModel,
				);
				item.values = ON_OFF_VALUES;
				break;
			case SETTING_IDS.compactionFiles:
				item.currentValue = toOnOff(
					state.config.includeFilesTouched.inCompactionSummary,
				);
				item.description = describeFilesTouchedSummary(
					state.config.includeFilesTouched.inCompactionSummary,
					"compaction",
				);
				item.values = ON_OFF_VALUES;
				break;
			case SETTING_IDS.branchFiles:
				item.currentValue = toOnOff(
					state.config.includeFilesTouched.inBranchSummary,
				);
				item.description = describeFilesTouchedSummary(
					state.config.includeFilesTouched.inBranchSummary,
					"branch",
				);
				item.values = ON_OFF_VALUES;
				break;
			case SETTING_IDS.defaultPreset:
				item.currentValue = state.config.defaultPreset;
				item.description = describeDefaultPreset(state);
				break;
			case SETTING_IDS.presets: {
				const presetCount = getPresetNames(state.config).length;
				item.currentValue =
					presetCount === 1 ? "1 preset" : `${String(presetCount)} presets`;
				item.description = describePresetCollection(state);
				break;
			}
			case SETTING_IDS.compactionPrompt:
				item.currentValue = promptValue(state.compactionPrompt);
				item.description = describePromptResolution(
					"compaction",
					state.compactionPrompt,
				);
				break;
			case SETTING_IDS.branchPrompt:
				item.currentValue = promptValue(state.branchSummaryPrompt);
				item.description = describePromptResolution(
					"branch-summary",
					state.branchSummaryPrompt,
				);
				break;
		}
	}
}

async function chooseScope(
	ctx: ExtensionCommandContext,
	allowProject: boolean,
): Promise<ConfigScope | undefined> {
	if (!allowProject) {
		return "global";
	}

	const result = await ctx.ui.select("Choose scope", ["global", "project"]);
	if (result === "global" || result === "project") {
		return result;
	}

	return undefined;
}

async function promptForPreset(
	ctx: ExtensionCommandContext,
	name: string,
	current?: PresetConfig,
): Promise<PresetConfig | undefined> {
	const model = await ctx.ui.input(
		`${name}: provider/modelId`,
		current?.model ?? "anthropic/claude-sonnet-4",
	);
	const normalizedModel = model?.trim();
	if (!normalizedModel) {
		return undefined;
	}

	const thinkingSelection = await ctx.ui.select(`${name}: thinking level`, [
		...THINKING_LEVEL_VALUES,
	]);
	if (!thinkingSelection) {
		return undefined;
	}

	return {
		model: normalizedModel,
		thinkingLevel: parseThinkingLevelSelection(thinkingSelection),
	};
}

async function editPrompt(
	kind: PromptKind,
	scope: ConfigScope,
	ctx: ExtensionCommandContext,
	controller: LiveCompactionController,
): Promise<void> {
	const state = await controller.loadState(ctx, scope);
	const currentText =
		kind === "compaction"
			? state.compactionPrompt.text
			: state.branchSummaryPrompt.text;
	const edited = await ctx.ui.editor(
		`${promptLabel(kind)} (${scope})`,
		currentText,
	);
	if (edited === undefined) {
		return;
	}

	await controller.savePrompt(scope, kind, edited, ctx);
	ctx.ui.notify(`${promptLabel(kind)} saved for ${scope} scope.`, "info");
}

async function resetPrompt(
	kind: PromptKind,
	scope: ConfigScope,
	ctx: ExtensionCommandContext,
	controller: LiveCompactionController,
): Promise<void> {
	const confirmed = await ctx.ui.confirm(
		`Reset ${promptLabel(kind)}`,
		`Remove the ${scope} ${promptLabel(kind).toLowerCase()} override?`,
	);
	if (!confirmed) {
		return;
	}

	await controller.resetPrompt(scope, kind, ctx);
	ctx.ui.notify(`${promptLabel(kind)} reset for ${scope} scope.`, "info");
}

async function managePreset(
	action: PanelExternalAction["action"],
	scope: ConfigScope,
	ctx: ExtensionCommandContext,
	controller: LiveCompactionController,
): Promise<void> {
	const state = await controller.loadState(ctx, scope);
	const presetNames = getPresetNames(state.config);

	if (action === "add") {
		const name = await ctx.ui.input("Preset name", "fast");
		const normalizedName = name?.trim();
		if (!normalizedName) {
			return;
		}

		const preset = await promptForPreset(ctx, normalizedName);
		if (!preset) {
			return;
		}

		await controller.upsertPreset(scope, normalizedName, preset, ctx);
		ctx.ui.notify(
			`Preset '${normalizedName}' saved for ${scope} scope.`,
			"info",
		);
		return;
	}

	if (presetNames.length === 0) {
		ctx.ui.notify(`No presets are defined for ${scope} scope.`, "warning");
		return;
	}

	const title =
		action === "edit" ? `Edit preset (${scope})` : `Delete preset (${scope})`;
	const presetName = await ctx.ui.select(title, presetNames);
	if (!presetName) {
		return;
	}

	if (action === "edit") {
		const preset = await promptForPreset(
			ctx,
			presetName,
			state.config.presets[presetName],
		);
		if (!preset) {
			return;
		}

		await controller.upsertPreset(scope, presetName, preset, ctx);
		ctx.ui.notify(`Preset '${presetName}' updated for ${scope} scope.`, "info");
		return;
	}

	const confirmed = await ctx.ui.confirm(
		"Delete preset",
		`Delete preset '${presetName}' from ${scope} scope?`,
	);
	if (!confirmed) {
		return;
	}

	await controller.deletePreset(scope, presetName, ctx);
	ctx.ui.notify(`Preset '${presetName}' deleted from ${scope} scope.`, "info");
}

async function pickInitialScope(
	ctx: ExtensionCommandContext,
): Promise<ConfigScope> {
	// Read the *global* effective config to decide which scope the panel
	// opens to. Reading global keeps the operator preference stable across
	// projects and avoids a chicken-and-egg where a project override would
	// silently change panel-open behaviour.
	try {
		const effective = await loadEffectiveConfig(ctx.cwd);
		const preference: PanelScope = effective.defaultPanelScope;
		if (preference === "project" && ctx.cwd) {
			return "project";
		}
		return "global";
	} catch {
		return "global";
	}
}

async function openPanel(
	ctx: ExtensionCommandContext,
	controller: LiveCompactionController,
): Promise<void> {
	let scope: ConfigScope = await pickInitialScope(ctx);

	while (true) {
		let state = await controller.loadState(ctx, scope);
		const action = await ctx.ui.custom<PanelExternalAction | undefined>(
			(tui, theme, _kb, done) => {
				const items = createPanelItems(
					() => state,
					theme,
					() => tui.requestRender(),
					done,
				);
				syncPanelItems(items, state);

				const container = new Container();
				container.addChild(
					new DynamicBorder((value: string) => theme.fg("accent", value)),
				);
				container.addChild(
					new Text(theme.fg("accent", theme.bold("Grounded Compaction")), 0, 0),
				);
				container.addChild(
					new Text(theme.fg("dim", controller.summarizeState(state)), 0, 0),
				);

				let settingsList: SettingsList | null = null;
				const refreshState = async (): Promise<void> => {
					state = await controller.loadState(ctx, scope);
					syncPanelItems(items, state);
					settingsList?.invalidate();
					container.invalidate();
					tui.requestRender();
				};

				settingsList = new SettingsList(
					items,
					12,
					getSettingsListTheme(),
					async (id, newValue) => {
						if (id === SETTING_IDS.scope) {
							if (newValue === "global" || newValue === "project") {
								scope = newValue;
								await refreshState();
							}
							return;
						}

						if (id === SETTING_IDS.defaultScope) {
							if (newValue === "global" || newValue === "project") {
								await controller.setConfig(
									scope,
									{ ...state.config, defaultPanelScope: newValue },
									ctx,
								);
								await refreshState();
							}
							return;
						}

						if (id === SETTING_IDS.inheritSessionModel) {
							await controller.setConfig(
								scope,
								{
									...state.config,
									inheritSessionModel: newValue === "on",
								},
								ctx,
							);
							await refreshState();
							return;
						}

						if (
							id === SETTING_IDS.compactionFiles ||
							id === SETTING_IDS.branchFiles
						) {
							const next = {
								...state.config,
								includeFilesTouched: {
									...state.config.includeFilesTouched,
									...(id === SETTING_IDS.compactionFiles
										? { inCompactionSummary: newValue === "on" }
										: { inBranchSummary: newValue === "on" }),
								},
							};
							await controller.setConfig(scope, next, ctx);
							await refreshState();
							return;
						}

						if (id === SETTING_IDS.defaultPreset) {
							await controller.setConfig(
								scope,
								{ ...state.config, defaultPreset: newValue },
								ctx,
							);
							await refreshState();
						}
					},
					() => done(undefined),
					{ enableSearch: true },
				);

				container.addChild(settingsList);
				container.addChild(
					new Text(
						theme.fg(
							"dim",
							"/live-compaction show • verify • path • reset",
						),
						0,
					),
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
			},
		);

		if (!action) {
			return;
		}

		if (action.kind === "preset") {
			await managePreset(action.action, scope, ctx, controller);
			continue;
		}

		if (action.action === "edit") {
			await editPrompt(action.promptKind, scope, ctx, controller);
			continue;
		}

		await resetPrompt(action.promptKind, scope, ctx, controller);
	}
}

export function registerLiveCompactionCommand(pi: ExtensionAPI): void {
	const controller = createLiveCompactionController();

	pi.registerCommand(COMMAND_NAME, {
		description: "Inspect and configure live compaction",
		getArgumentCompletions: getSubcommandCompletions,
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();
			if (normalized === "show") {
				const scope: ConfigScope = ctx.cwd ? "project" : "global";
				const state = await controller.loadState(ctx, scope);
				ctx.ui.notify(controller.summarizeState(state), "info");
				return;
			}

			if (normalized === "verify") {
				const status = await controller.refreshRuntimeStatus(ctx);
				ctx.ui.notify(
					status.available
						? "Grounded compaction verification passed."
						: status.issues.join(" | "),
					status.available ? "info" : "warning",
				);
				return;
			}

			if (normalized === "path") {
				const { global, project } = controller.getPaths(ctx);
				ctx.ui.notify(
					project
						? `global: ${global.rootDir} | project: ${project.rootDir}`
						: `global: ${global.rootDir}`,
					"info",
				);
				return;
			}

			if (normalized === "reset") {
				const scope = ctx.hasUI
					? await chooseScope(ctx, Boolean(ctx.cwd))
					: ctx.cwd
						? "project"
						: "global";
				if (!scope) {
					return;
				}

				await controller.resetScope(scope, ctx);
				ctx.ui.notify(`Grounded compaction reset for ${scope} scope.`, "info");
				return;
			}

			if (normalized === "help") {
				ctx.ui.notify(controller.getUsageText(), "info");
				return;
			}

			if (normalized) {
				ctx.ui.notify(controller.getUsageText(), "warning");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify(`/${COMMAND_NAME} requires interactive mode.`, "warning");
				return;
			}

			await openPanel(ctx, controller);
		},
	});
}
