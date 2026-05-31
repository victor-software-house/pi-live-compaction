import { createHash } from 'node:crypto';

import { CURRENT_PRESET_SENTINEL, type LiveCompactionConfig } from '@live-compaction/config';
import type { ParsedCompactInstructions, PresetMatchResult } from '@live-compaction/types';

export function sha256(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

export function parseCompactInstructions(text?: string): ParsedCompactInstructions {
	const trimmed = text?.trim() ?? '';
	if (!trimmed) {
		return { usesPresetDirective: false };
	}

	if (!trimmed.startsWith('--preset') && !trimmed.startsWith('-p')) {
		return {
			usesPresetDirective: false,
			focusText: trimmed,
		};
	}

	const presetPrefixPattern = /^(?:--preset\s+|-p\s+)(\S+)\s*([\s\S]*)$/;
	const match = presetPrefixPattern.exec(trimmed);

	if (!match) {
		return { usesPresetDirective: true };
	}

	const presetQuery = match[1];
	const focusText = match[2]?.trim() || undefined;
	return { usesPresetDirective: true, presetQuery, focusText };
}

function normalizePresetKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolvePresetMatch(config: LiveCompactionConfig, query: string): PresetMatchResult {
	const normalizedQuery = normalizePresetKey(query);
	if (!normalizedQuery) {
		return { kind: 'unmatched' };
	}

	if (normalizedQuery === 'current' || normalizedQuery === CURRENT_PRESET_SENTINEL) {
		return { kind: 'matched', name: CURRENT_PRESET_SENTINEL };
	}

	const exactKey = Object.keys(config.presets).find(
		(name) => normalizePresetKey(name) === normalizedQuery,
	);
	if (exactKey) {
		return {
			kind: 'matched',
			name: exactKey,
			preset: config.presets[exactKey],
		};
	}

	const prefixMatches = Object.keys(config.presets).filter((name) =>
		normalizePresetKey(name).startsWith(normalizedQuery),
	);
	if (prefixMatches.length === 1) {
		return {
			kind: 'matched',
			name: prefixMatches[0],
			preset: config.presets[prefixMatches[0]],
		};
	}
	if (prefixMatches.length > 1) {
		return { kind: 'ambiguous' };
	}

	return { kind: 'unmatched' };
}
