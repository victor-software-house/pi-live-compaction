export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface IncludeFilesTouchedSettings {
	inCompactionSummary: boolean;
	inBranchSummary: boolean;
}

export interface PresetConfig {
	model: string;
	thinkingLevel?: ThinkingLevel;
}

export interface LiveCompactionConfig {
	includeFilesTouched: IncludeFilesTouchedSettings;
	defaultPreset: string;
	fallbackPreset?: string;
	presets: Record<string, PresetConfig>;
	/**
	 * Which scope the /live-compaction settings panel opens to by
	 * default. The shipped default is "global" so settings reads/writes
	 * default to durable global state and explicit project overrides are
	 * an opt-in. `"project"` falls back to global when no project session
	 * is active.
	 */
	defaultPanelScope: PanelScope;
	/**
	 * When true, ignore the configured `defaultPreset` for an automatic
	 * /compact run and always summarise with the current session model and
	 * thinking level instead. Off by default. An explicit `/compact
	 * --preset NAME` directive and a template `preset:` frontmatter both
	 * still win over this flag, since those are deliberate per-run choices.
	 */
	inheritSessionModel: boolean;
}

export type ConfigScope = 'global' | 'project';
/**
 * Panel-scope preference. Same shape as ConfigScope today, kept as a
 * separate alias so adding new modes later (e.g. `"last-used"`) does not
 * require touching every ConfigScope consumer.
 */
export type PanelScope = ConfigScope;
export type PromptKind = 'compaction' | 'branch-summary';

export interface LiveCompactionPaths {
	global: {
		scope: 'global';
		rootDir: string;
		configPath: string;
		compactionPromptPath: string;
		branchSummaryPromptPath: string;
	};
	project?: {
		scope: 'project';
		rootDir: string;
		configPath: string;
		compactionPromptPath: string;
		branchSummaryPromptPath: string;
	};
}

export interface PromptResolution {
	source: ConfigScope | 'default';
	text?: string;
	isOverride: boolean;
	isBlankOverride: boolean;
}

type JsonObject = Record<string, unknown>;

export const CURRENT_PRESET_SENTINEL = 'current';

const DEFAULT_INCLUDE_FILES_TOUCHED_SETTINGS: IncludeFilesTouchedSettings = {
	inCompactionSummary: true,
	inBranchSummary: true,
};

export const PANEL_SCOPE_VALUES: readonly PanelScope[] = ['global', 'project'];

export const DEFAULT_CONFIG: LiveCompactionConfig = {
	includeFilesTouched: DEFAULT_INCLUDE_FILES_TOUCHED_SETTINGS,
	defaultPreset: CURRENT_PRESET_SENTINEL,
	fallbackPreset: CURRENT_PRESET_SENTINEL,
	presets: {},
	defaultPanelScope: 'global',
	inheritSessionModel: false,
};

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePanelScope(value: unknown): PanelScope {
	if (value === undefined) {
		return DEFAULT_CONFIG.defaultPanelScope;
	}
	if (typeof value !== 'string') {
		throw new Error(
			"Invalid live-compaction config: defaultPanelScope must be one of 'global' or 'project'",
		);
	}
	const normalized = value.trim().toLowerCase();
	// Legacy "auto" maps onto "project" since the runtime semantics already
	// fall back to global when no project session is active.
	if (normalized === 'auto') {
		return 'project';
	}
	if (normalized === 'global' || normalized === 'project') {
		return normalized;
	}
	throw new Error(
		"Invalid live-compaction config: defaultPanelScope must be one of 'global' or 'project'",
	);
}

export function normalizeThinkingLevel(value: unknown): ThinkingLevel | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.trim().toLowerCase();
	if (
		normalized === 'off' ||
		normalized === 'minimal' ||
		normalized === 'low' ||
		normalized === 'medium' ||
		normalized === 'high' ||
		normalized === 'xhigh'
	) {
		return normalized;
	}
	return undefined;
}

export function normalizeOptionalText(value?: string): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

function expectBoolean(value: unknown, key: string): boolean {
	if (typeof value !== 'boolean') {
		throw new Error(`Invalid live-compaction config: ${key} must be a boolean`);
	}
	return value;
}

function parseIncludeFilesTouchedSettings(value: unknown): IncludeFilesTouchedSettings {
	if (value === undefined) {
		return structuredClone(DEFAULT_INCLUDE_FILES_TOUCHED_SETTINGS);
	}
	if (typeof value === 'boolean') {
		return {
			inCompactionSummary: value,
			inBranchSummary: value,
		};
	}
	if (!isObject(value)) {
		throw new Error(
			'Invalid live-compaction config: includeFilesTouched must be a boolean or an object with inCompactionSummary and inBranchSummary',
		);
	}
	return {
		inCompactionSummary: expectBoolean(
			value.inCompactionSummary,
			'includeFilesTouched.inCompactionSummary',
		),
		inBranchSummary: expectBoolean(value.inBranchSummary, 'includeFilesTouched.inBranchSummary'),
	};
}

export function parseConfig(value: unknown): LiveCompactionConfig {
	if (!isObject(value)) {
		throw new Error('Invalid live-compaction config: top-level value must be an object');
	}

	const includeFilesTouched = parseIncludeFilesTouchedSettings(value.includeFilesTouched);

	const defaultPreset =
		value.defaultPreset === undefined
			? DEFAULT_CONFIG.defaultPreset
			: typeof value.defaultPreset === 'string' && value.defaultPreset.trim()
				? value.defaultPreset.trim()
				: (() => {
						throw new Error(
							'Invalid live-compaction config: defaultPreset must be a non-empty string',
						);
					})();

	const fallbackPreset =
		value.fallbackPreset === undefined
			? DEFAULT_CONFIG.fallbackPreset
			: typeof value.fallbackPreset === 'string' && value.fallbackPreset.trim()
				? value.fallbackPreset.trim()
				: (() => {
						throw new Error(
							'Invalid live-compaction config: fallbackPreset must be a non-empty string when provided',
						);
					})();

	const presetsValue = value.presets === undefined ? {} : value.presets;
	if (!isObject(presetsValue)) {
		throw new Error('Invalid live-compaction config: presets must be an object');
	}

	const presets: Record<string, PresetConfig> = {};
	for (const [presetName, presetValue] of Object.entries(presetsValue)) {
		if (!presetName.trim()) {
			throw new Error('Invalid live-compaction config: preset names must be non-empty strings');
		}
		if (!isObject(presetValue)) {
			throw new Error(`Invalid live-compaction config: preset '${presetName}' must be an object`);
		}
		if (typeof presetValue.model !== 'string' || !presetValue.model.trim()) {
			throw new Error(`Invalid live-compaction config: preset '${presetName}' must define model`);
		}
		const thinkingLevel =
			presetValue.thinkingLevel === undefined
				? undefined
				: normalizeThinkingLevel(presetValue.thinkingLevel);
		if (presetValue.thinkingLevel !== undefined && !thinkingLevel) {
			throw new Error(
				`Invalid live-compaction config: preset '${presetName}' has an invalid thinkingLevel`,
			);
		}
		presets[presetName] = {
			model: presetValue.model.trim(),
			thinkingLevel,
		};
	}

	if (defaultPreset !== CURRENT_PRESET_SENTINEL && !presets[defaultPreset]) {
		throw new Error(
			`Invalid live-compaction config: defaultPreset '${defaultPreset}' was not found in presets`,
		);
	}

	if (
		fallbackPreset !== undefined &&
		fallbackPreset !== CURRENT_PRESET_SENTINEL &&
		!presets[fallbackPreset]
	) {
		throw new Error(
			`Invalid live-compaction config: fallbackPreset '${fallbackPreset}' was not found in presets`,
		);
	}

	const defaultPanelScope = parsePanelScope(value.defaultPanelScope);

	const inheritSessionModel =
		value.inheritSessionModel === undefined
			? DEFAULT_CONFIG.inheritSessionModel
			: expectBoolean(value.inheritSessionModel, 'inheritSessionModel');

	return {
		includeFilesTouched,
		defaultPreset,
		fallbackPreset,
		presets,
		defaultPanelScope,
		inheritSessionModel,
	};
}
