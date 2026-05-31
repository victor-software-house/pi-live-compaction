import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import {
	CURRENT_PRESET_SENTINEL,
	type LiveCompactionConfig,
	normalizeThinkingLevel,
	type ThinkingLevel,
} from '@live-compaction/config';
import { CompactionAbortedError } from '@live-compaction/errors';
import { resolvePresetMatch } from '@live-compaction/preset/matching';
import type { HookContext, ResolvedSummarizer, StreamSimple } from '@live-compaction/types';

export function getEffectiveThinkingLevel(branchEntries: SessionEntry[]): ThinkingLevel {
	for (let i = branchEntries.length - 1; i >= 0; i--) {
		const entry = branchEntries[i];
		if (entry.type === 'thinking_level_change') {
			const level = normalizeThinkingLevel(entry.thinkingLevel);
			if (level) {
				return level;
			}
		}
	}
	return 'off';
}

function parseProviderModel(value: string): { provider: string; modelId: string } {
	const slashIndex = value.indexOf('/');
	if (slashIndex < 0) {
		throw new Error(`Invalid model format '${value}': expected 'provider/model-id'`);
	}
	return {
		provider: value.slice(0, slashIndex),
		modelId: value.slice(slashIndex + 1),
	};
}

function getRegisteredStreamSimple(
	ctx: HookContext,
	model: ResolvedSummarizer['model'],
): StreamSimple | undefined {
	const registry = ctx.modelRegistry as unknown as {
		registeredProviders?: Map<string, { streamSimple?: StreamSimple }>;
	};
	return registry.registeredProviders?.get(model.provider)?.streamSimple;
}

export async function resolveDefaultSummarizer(
	ctx: HookContext,
	branchEntries: SessionEntry[],
): Promise<ResolvedSummarizer> {
	const model = ctx.model;
	if (!model) {
		throw new CompactionAbortedError();
	}
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(`Auth failed for session model: ${auth.error}`);
	}
	return {
		model,
		apiKey: auth.apiKey,
		headers: auth.headers,
		reasoningLevel: getEffectiveThinkingLevel(branchEntries),
		streamSimple: getRegisteredStreamSimple(ctx, model),
	};
}

export async function resolvePresetSummarizer(
	ctx: HookContext,
	config: LiveCompactionConfig,
	presetQuery: string,
): Promise<ResolvedSummarizer> {
	const match = resolvePresetMatch(config, presetQuery);

	switch (match.kind) {
		case 'ambiguous':
			throw new Error(`Ambiguous preset query '${presetQuery}': matches multiple presets`);
		case 'unmatched':
			throw new Error(`No preset matches '${presetQuery}'`);
		case 'matched':
			break;
	}

	if (match.name === CURRENT_PRESET_SENTINEL || !match.preset) {
		const model = ctx.model;
		if (!model) {
			throw new CompactionAbortedError();
		}
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) {
			throw new Error(`Auth failed for session model: ${auth.error}`);
		}
		return {
			model,
			apiKey: auth.apiKey,
			headers: auth.headers,
			reasoningLevel: match.preset?.thinkingLevel,
			streamSimple: getRegisteredStreamSimple(ctx, model),
		};
	}

	const { provider, modelId } = parseProviderModel(match.preset.model);
	const model = ctx.modelRegistry
		.getAll()
		.find(
			(m) =>
				m.provider.toLowerCase() === provider.toLowerCase() &&
				m.id.toLowerCase() === modelId.toLowerCase(),
		);
	if (!model) {
		throw new Error(`Model '${match.preset.model}' not found in model registry`);
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(`Auth failed for preset model '${match.preset.model}': ${auth.error}`);
	}

	return {
		model,
		apiKey: auth.apiKey,
		headers: auth.headers,
		reasoningLevel: match.preset.thinkingLevel,
		streamSimple: getRegisteredStreamSimple(ctx, model),
	};
}

export function describeConfiguredFallback(config: LiveCompactionConfig): string {
	if (config.fallbackPreset && config.fallbackPreset !== CURRENT_PRESET_SENTINEL) {
		return `preset '${config.fallbackPreset}'`;
	}
	return 'the current session model';
}

export function describePresetFallback(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function resolveConfiguredFallbackSummarizer(
	ctx: HookContext,
	config: LiveCompactionConfig,
	branchEntries: SessionEntry[],
	excludedPreset?: string,
): Promise<ResolvedSummarizer> {
	if (
		config.fallbackPreset &&
		config.fallbackPreset !== CURRENT_PRESET_SENTINEL &&
		config.fallbackPreset !== excludedPreset
	) {
		return resolvePresetSummarizer(ctx, config, config.fallbackPreset);
	}
	return resolveDefaultSummarizer(ctx, branchEntries);
}
