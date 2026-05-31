import type { AutocompleteItem } from '@earendil-works/pi-tui';

export const COMMAND_NAME = 'live-compaction';
export const SUBCOMMANDS = ['show', 'verify', 'path', 'reset', 'help'];
export const ON_OFF_VALUES = ['off', 'on'];
export const THINKING_LEVEL_VALUES = [
	'unset',
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
] as const;

export function getSubcommandCompletions(prefix: string): AutocompleteItem[] | null {
	const trimmed = prefix.trimStart();
	const matches = SUBCOMMANDS.filter((value) => value.startsWith(trimmed));
	return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
}
