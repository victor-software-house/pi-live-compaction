import type { ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';

import {
	type ConfigScope,
	CURRENT_PRESET_SENTINEL,
	deleteScopedPrompt,
	type LiveCompactionConfig,
	type LiveCompactionPaths,
	loadEditableScopedConfig,
	loadEffectiveConfig,
	type PresetConfig,
	type PromptKind,
	type PromptResolution,
	resetLiveCompactionScope,
	resolveEffectivePrompt,
	resolveLiveCompactionPaths,
	saveScopedConfig,
	saveScopedPromptText,
	scopeHasLocalOverrides,
	type ThinkingLevel,
} from '@live-compaction/config';

export interface RuntimeStatus {
	available: boolean;
	issues: string[];
	lastCheckedAt?: number;
}

export interface LiveCompactionState {
	scope: ConfigScope;
	config: LiveCompactionConfig;
	paths: LiveCompactionPaths;
	compactionPrompt: PromptResolution;
	branchSummaryPrompt: PromptResolution;
	projectScopeAvailable: boolean;
	projectScopeHasOverrides: boolean;
	runtimeStatus: RuntimeStatus;
}

export interface LiveCompactionController {
	loadState(ctx: ExtensionContext, scope: ConfigScope): Promise<LiveCompactionState>;
	setConfig(
		scope: ConfigScope,
		next: LiveCompactionConfig,
		ctx: ExtensionCommandContext,
	): Promise<void>;
	upsertPreset(
		scope: ConfigScope,
		name: string,
		preset: PresetConfig,
		ctx: ExtensionCommandContext,
	): Promise<void>;
	deletePreset(scope: ConfigScope, name: string, ctx: ExtensionCommandContext): Promise<void>;
	savePrompt(
		scope: ConfigScope,
		kind: PromptKind,
		text: string,
		ctx: ExtensionCommandContext,
	): Promise<void>;
	resetPrompt(scope: ConfigScope, kind: PromptKind, ctx: ExtensionCommandContext): Promise<void>;
	resetScope(scope: ConfigScope, ctx: ExtensionCommandContext): Promise<void>;
	refreshRuntimeStatus(ctx: ExtensionContext): Promise<RuntimeStatus>;
	getPaths(ctx: ExtensionContext): LiveCompactionPaths;
	summarizeState(state: LiveCompactionState): string;
	getUsageText(): string;
}

const USAGE_TEXT = 'Usage: /live-compaction [show|verify|path|reset|help]';

function createDefaultRuntimeStatus(): RuntimeStatus {
	return {
		available: true,
		issues: [],
	};
}

function cloneConfig(config: LiveCompactionConfig): LiveCompactionConfig {
	return {
		includeFilesTouched: {
			inCompactionSummary: config.includeFilesTouched.inCompactionSummary,
			inBranchSummary: config.includeFilesTouched.inBranchSummary,
		},
		defaultPreset: config.defaultPreset,
		fallbackPreset: config.fallbackPreset,
		presets: Object.fromEntries(
			Object.entries(config.presets).map(([name, preset]) => [name, { ...preset }]),
		),
		defaultPanelScope: config.defaultPanelScope,
		inheritSessionModel: config.inheritSessionModel,
	};
}

function describePromptSource(kind: PromptKind, prompt: PromptResolution): string {
	if (kind === 'compaction') {
		if (prompt.source === 'default') {
			return 'compactionPrompt=default';
		}

		if (prompt.isBlankOverride) {
			return `compactionPrompt=${prompt.source}:blank->default`;
		}

		return `compactionPrompt=${prompt.source}:custom`;
	}

	if (prompt.source === 'default') {
		return 'branchPrompt=default';
	}

	if (prompt.isBlankOverride) {
		return `branchPrompt=${prompt.source}:blank->disabled`;
	}

	return `branchPrompt=${prompt.source}:custom`;
}

function validateConfigAgainstModels(
	config: LiveCompactionConfig,
	ctx: ExtensionContext,
): string[] {
	const issues: string[] = [];
	const models = ctx.modelRegistry.getAll();

	for (const [name, preset] of Object.entries(config.presets)) {
		const separatorIndex = preset.model.indexOf('/');
		if (separatorIndex <= 0 || separatorIndex === preset.model.length - 1) {
			issues.push(`Preset '${name}' uses invalid model '${preset.model}'.`);
			continue;
		}

		const provider = preset.model.slice(0, separatorIndex);
		const modelId = preset.model.slice(separatorIndex + 1);
		const model = models.find(
			(candidate) => candidate.provider === provider && candidate.id === modelId,
		);
		if (!model) {
			issues.push(`Preset '${name}' model ${preset.model} is not registered.`);
			continue;
		}

		if (preset.thinkingLevel && preset.thinkingLevel !== 'off' && !model.reasoning) {
			issues.push(
				`Preset '${name}' requires reasoning level '${preset.thinkingLevel}' but ${preset.model} does not support reasoning.`,
			);
		}
	}

	return issues;
}

function getEffectiveScope(state: LiveCompactionState): ConfigScope | 'default' {
	if (state.scope === 'project' || !state.projectScopeAvailable) {
		return state.scope;
	}

	if (state.projectScopeHasOverrides) {
		return 'project';
	}

	return 'global';
}

export function createLiveCompactionController(): LiveCompactionController {
	let runtimeStatus = createDefaultRuntimeStatus();

	async function buildState(
		ctx: ExtensionContext,
		scope: ConfigScope,
	): Promise<LiveCompactionState> {
		const paths = resolveLiveCompactionPaths(ctx.cwd);
		const config = await loadEditableScopedConfig(scope, ctx.cwd);
		const [compactionPrompt, branchSummaryPrompt, projectScopeHasOverrides] = await Promise.all([
			resolveEffectivePrompt('compaction', scope === 'project' ? ctx.cwd : undefined, undefined),
			resolveEffectivePrompt(
				'branch-summary',
				scope === 'project' ? ctx.cwd : undefined,
				undefined,
			),
			paths.project ? scopeHasLocalOverrides('project', ctx.cwd) : Promise.resolve(false),
		]);

		return {
			scope,
			config,
			paths,
			compactionPrompt,
			branchSummaryPrompt,
			projectScopeAvailable: Boolean(paths.project),
			projectScopeHasOverrides,
			runtimeStatus,
		};
	}

	return {
		async loadState(ctx, scope) {
			return buildState(ctx, scope);
		},

		async setConfig(scope, next, ctx) {
			try {
				await saveScopedConfig(scope, next, ctx.cwd);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, 'error');
			}
		},

		async upsertPreset(scope, name, preset, ctx) {
			const config = cloneConfig(await loadEditableScopedConfig(scope, ctx.cwd));
			config.presets[name] = preset;
			if (
				config.defaultPreset !== CURRENT_PRESET_SENTINEL &&
				!config.presets[config.defaultPreset]
			) {
				config.defaultPreset = name;
			}
			await this.setConfig(scope, config, ctx);
		},

		async deletePreset(scope, name, ctx) {
			const config = cloneConfig(await loadEditableScopedConfig(scope, ctx.cwd));
			delete config.presets[name];
			if (config.defaultPreset === name) {
				config.defaultPreset = CURRENT_PRESET_SENTINEL;
			}
			await this.setConfig(scope, config, ctx);
		},

		async savePrompt(scope, kind, text, ctx) {
			try {
				await saveScopedPromptText(kind, scope, text, ctx.cwd);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, 'error');
			}
		},

		async resetPrompt(scope, kind, ctx) {
			try {
				await deleteScopedPrompt(kind, scope, ctx.cwd);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, 'error');
			}
		},

		async resetScope(scope, ctx) {
			try {
				await resetLiveCompactionScope(scope, ctx.cwd);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, 'error');
			}
		},

		async refreshRuntimeStatus(ctx) {
			const config = await loadEffectiveConfig(ctx.cwd);
			const issues = validateConfigAgainstModels(config, ctx);
			runtimeStatus = {
				available: issues.length === 0,
				issues,
				lastCheckedAt: Date.now(),
			};
			return runtimeStatus;
		},

		getPaths(ctx) {
			return resolveLiveCompactionPaths(ctx.cwd);
		},

		summarizeState(state) {
			const presetNames = Object.keys(state.config.presets);
			const effectiveScope = getEffectiveScope(state);
			const runtimePart = state.runtimeStatus.available
				? 'runtime=ok'
				: `runtime=issues:${state.runtimeStatus.issues.length}`;
			return [
				`scope=${state.scope}`,
				`effective=${effectiveScope}`,
				`filesTouched=compaction:${state.config.includeFilesTouched.inCompactionSummary ? 'on' : 'off'},branch:${state.config.includeFilesTouched.inBranchSummary ? 'on' : 'off'}`,
				`defaultPreset=${state.config.defaultPreset}`,
				`presets=${presetNames.length === 0 ? 'none' : presetNames.join(',')}`,
				describePromptSource('compaction', state.compactionPrompt),
				describePromptSource('branch-summary', state.branchSummaryPrompt),
				runtimePart,
			].join(' | ');
		},

		getUsageText() {
			return USAGE_TEXT;
		},
	};
}

export function getPresetNames(config: LiveCompactionConfig): string[] {
	return Object.keys(config.presets).sort((left, right) => left.localeCompare(right));
}

export function buildPresetChoices(config: LiveCompactionConfig): string[] {
	return [CURRENT_PRESET_SENTINEL, ...getPresetNames(config)];
}

export function formatThinkingLevel(value?: ThinkingLevel): string {
	return value ?? 'unset';
}

export function parseThinkingLevelSelection(value: string): ThinkingLevel | undefined {
	return value === 'unset' ? undefined : (value as ThinkingLevel);
}
