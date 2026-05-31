import {
	extractShellOperands,
	splitShellCommands,
	stripShellCommandWrappers,
} from '@live-compaction/files-touched/tokenizer';
import type { FileTouchOperation, FileTrackingAction } from '@live-compaction/files-touched/types';

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export function firstDefinedString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === 'string' && value.length > 0) return value;
	}
	return null;
}

function extractJsonObject(text: string, prefix: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith(prefix)) return null;
	const jsonText = trimmed.slice(prefix.length).trim();
	if (!jsonText.startsWith('{')) return null;
	try {
		const parsed = JSON.parse(jsonText);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function extractCliNamedArg(cmd: string, key: string): string | null {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = cmd.match(new RegExp(`(?:^|\\s)${escapedKey}=(?:"([^"]+)"|'([^']+)'|(\\S+))`));
	return firstDefinedString(...(match?.slice(1) ?? []));
}

function commandStartsWith(cmd: string, name: string): boolean {
	const trimmed = cmd.trim();
	return trimmed === name || trimmed.startsWith(`${name} `);
}

function extractReadPathFromCliCommand(cmd: string): string | null {
	const readFileMatch = cmd.match(/(?:^|\s)read_file\s+.*?\bpath=(?:"([^"]+)"|'([^']+)'|(\S+))/);
	if (readFileMatch) {
		return stripReadSliceSuffix(firstDefinedString(...readFileMatch.slice(1)) ?? '');
	}
	const simpleReadMatch = cmd.match(/^(?:read|cat)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
	if (simpleReadMatch) {
		return stripReadSliceSuffix(firstDefinedString(...simpleReadMatch.slice(1)) ?? '');
	}
	return null;
}

function stripReadSliceSuffix(value: string): string {
	return value.replace(/:(\d+)-(\d+)$/, '');
}

// ---------------------------------------------------------------------------
// Shell parsing helpers
// ---------------------------------------------------------------------------

function isIgnoredRedirectTarget(value: string): boolean {
	return value === '/dev/null' || value === '/dev/stderr' || value === '/dev/stdout';
}

function extractRedirectWriteTargets(tokens: string[], actions: FileTrackingAction[]): void {
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === '>' || token === '>>') {
			if (i + 1 < tokens.length && !isIgnoredRedirectTarget(tokens[i + 1])) {
				actions.push({ kind: 'touch', path: tokens[i + 1], operation: 'write' });
			}
			i += 1;
			continue;
		}
		if (token.startsWith('>>') && token.length > 2) {
			const target = token.slice(2);
			if (!isIgnoredRedirectTarget(target)) {
				actions.push({ kind: 'touch', path: target, operation: 'write' });
			}
			continue;
		}
		if (token.startsWith('>') && token.length > 1) {
			const target = token.slice(1);
			if (!isIgnoredRedirectTarget(target)) {
				actions.push({ kind: 'touch', path: target, operation: 'write' });
			}
		}
	}
}

function looksLikeSedExpression(value: string): boolean {
	return /^[sy]?\/.+\//.test(value) || /^\d+[,\d]*[acdipqs]?$/.test(value);
}

function stripRedirectTokens(tokens: string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === '>' || token === '>>' || token === '>|' || token === '<') {
			i += 1;
			continue;
		}
		if (token === '<<' || token === '<<-' || token === '<<~') {
			i += 1;
			continue;
		}
		if (
			token.startsWith('>>') ||
			token.startsWith('>') ||
			token.startsWith('<<') ||
			token.startsWith('<')
		) {
			continue;
		}
		result.push(token);
	}
	return result;
}

function stripHeredocBodies(cmd: string): string {
	const lines = cmd.split('\n');
	const result: string[] = [];
	let terminator: string | null = null;
	let justClosedHeredoc = false;
	for (const line of lines) {
		if (terminator !== null) {
			if (line.trim() === terminator) {
				terminator = null;
				justClosedHeredoc = true;
			}
			continue;
		}
		const match = line.match(/<<-?\s*(?:['"]([\w]+)['"]|([\w]+))/);
		if (match) terminator = match[1] ?? match[2];
		if (justClosedHeredoc) {
			result.push(`; ${line}`);
			justClosedHeredoc = false;
		} else result.push(line);
	}
	return result.join('\n');
}

// ---------------------------------------------------------------------------
// Bash action parser
// ---------------------------------------------------------------------------

export function parseBashActions(cmd: string): FileTrackingAction[] {
	const actions: FileTrackingAction[] = [];
	for (const tokens of splitShellCommands(stripHeredocBodies(cmd))) {
		extractRedirectWriteTargets(tokens, actions);
		const command = stripShellCommandWrappers(stripRedirectTokens(tokens));
		if (command.length === 0) continue;

		if (command[0] === 'git' && command[1] === 'mv') {
			const operands = extractShellOperands(command.slice(2));
			if (operands.length === 2) actions.push({ kind: 'move', from: operands[0], to: operands[1] });
			continue;
		}
		if (command[0] === 'git' && command[1] === 'rm') {
			for (const operand of extractShellOperands(command.slice(2)))
				actions.push({ kind: 'touch', path: operand, operation: 'delete' });
			continue;
		}
		if (command[0] === 'mv') {
			const operands = extractShellOperands(command.slice(1));
			if (operands.length === 2) actions.push({ kind: 'move', from: operands[0], to: operands[1] });
			continue;
		}
		if (
			command[0] === 'rm' ||
			command[0] === 'trash' ||
			command[0] === 'trash-put' ||
			command[0] === 'unlink'
		) {
			for (const operand of extractShellOperands(command.slice(1)))
				actions.push({ kind: 'touch', path: operand, operation: 'delete' });
			continue;
		}
		if (command[0] === 'sed') {
			if (command.some((t) => /^-[a-z]*i/.test(t))) {
				const hasExplicitExpr = command.some((t) => t === '-e' || t === '-f');
				const operands = extractShellOperands(command.slice(1));
				const fileOperands = hasExplicitExpr ? operands : operands.slice(1);
				for (const operand of fileOperands)
					if (!looksLikeSedExpression(operand))
						actions.push({ kind: 'touch', path: operand, operation: 'edit' });
			}
			continue;
		}
		if (command[0] === 'cp' || command[0] === 'rsync') {
			const operands = extractShellOperands(command.slice(1));
			if (operands.length >= 2)
				actions.push({ kind: 'touch', path: operands[operands.length - 1], operation: 'write' });
			continue;
		}
		if (command[0] === 'tee' || command[0] === 'touch') {
			for (const operand of extractShellOperands(command.slice(1)))
				actions.push({ kind: 'touch', path: operand, operation: 'write' });
			continue;
		}
		if (command[0] === 'patch') {
			const operands = extractShellOperands(command.slice(1));
			if (operands.length > 0)
				actions.push({ kind: 'touch', path: operands[0], operation: 'edit' });
			continue;
		}
		if (command[0] === 'curl') {
			for (let i = 1; i < command.length; i++) {
				if ((command[i] === '-o' || command[i] === '--output') && i + 1 < command.length) {
					actions.push({ kind: 'touch', path: command[i + 1], operation: 'write' });
					break;
				}
			}
			continue;
		}
		if (command[0] === 'wget') {
			for (let i = 1; i < command.length; i++) {
				if ((command[i] === '-O' || command[i] === '--output-document') && i + 1 < command.length) {
					actions.push({ kind: 'touch', path: command[i + 1], operation: 'write' });
					break;
				}
			}
			continue;
		}
		if (command[0] === 'cat' || command[0] === 'head' || command[0] === 'tail') {
			for (const operand of extractShellOperands(command.slice(1)))
				actions.push({ kind: 'touch', path: operand, operation: 'read' });
		}
	}
	return actions;
}

// ---------------------------------------------------------------------------
// rp_exec action parser
// ---------------------------------------------------------------------------

export function parseRpExecActions(cmd: string): FileTrackingAction[] {
	const normalized = cmd.trim();
	if (!normalized) return [];
	const actions: FileTrackingAction[] = [];

	const readFileArgs = extractJsonObject(normalized, 'call read_file');
	if (readFileArgs && typeof readFileArgs.path === 'string') {
		actions.push({
			kind: 'touch',
			path: stripReadSliceSuffix(readFileArgs.path),
			operation: 'read',
		});
	}

	const applyEditsArgs = extractJsonObject(normalized, 'call apply_edits');
	if (applyEditsArgs && typeof applyEditsArgs.path === 'string') {
		actions.push({ kind: 'touch', path: applyEditsArgs.path, operation: 'edit' });
	}

	const fileActionsArgs = extractJsonObject(normalized, 'call file_actions');
	if (fileActionsArgs) {
		const action = typeof fileActionsArgs.action === 'string' ? fileActionsArgs.action : '';
		const targetPath = typeof fileActionsArgs.path === 'string' ? fileActionsArgs.path : null;
		const newPath = typeof fileActionsArgs.new_path === 'string' ? fileActionsArgs.new_path : null;
		if (action === 'create' && targetPath)
			actions.push({ kind: 'touch', path: targetPath, operation: 'write' });
		if (action === 'delete' && targetPath)
			actions.push({ kind: 'touch', path: targetPath, operation: 'delete' });
		if (action === 'move' && targetPath && newPath)
			actions.push({ kind: 'move', from: targetPath, to: newPath });
	}

	if (commandStartsWith(normalized, 'apply_edits')) {
		const targetPath = extractCliNamedArg(normalized, 'path');
		if (targetPath) actions.push({ kind: 'touch', path: targetPath, operation: 'edit' });
	}

	if (commandStartsWith(normalized, 'file_actions')) {
		const action = extractCliNamedArg(normalized, 'action');
		const targetPath = extractCliNamedArg(normalized, 'path');
		const newPath = extractCliNamedArg(normalized, 'new_path');
		if (action === 'create' && targetPath)
			actions.push({ kind: 'touch', path: targetPath, operation: 'write' });
		if (action === 'delete' && targetPath)
			actions.push({ kind: 'touch', path: targetPath, operation: 'delete' });
		if (action === 'move' && targetPath && newPath)
			actions.push({ kind: 'move', from: targetPath, to: newPath });
	}

	for (const command of splitShellCommands(normalized)) {
		if (command[0] !== 'file') continue;
		if (command[1] === 'delete') {
			for (const operand of extractShellOperands(command.slice(2)))
				actions.push({ kind: 'touch', path: operand, operation: 'delete' });
			continue;
		}
		if (command[1] === 'move') {
			const operands = extractShellOperands(command.slice(2));
			if (operands.length === 2) actions.push({ kind: 'move', from: operands[0], to: operands[1] });
		}
	}

	const readPath = extractReadPathFromCliCommand(normalized);
	if (readPath) actions.push({ kind: 'touch', path: readPath, operation: 'read' });
	return actions;
}

// ---------------------------------------------------------------------------
// Tool action dispatcher
// ---------------------------------------------------------------------------

export function getTrackedToolActions(
	name: string,
	args: Record<string, unknown>,
): FileTrackingAction[] {
	if ((name === 'read' || name === 'write' || name === 'edit') && typeof args.path === 'string') {
		return [{ kind: 'touch', path: args.path, operation: name as FileTouchOperation }];
	}

	if (name === 'rp') {
		const rpCall = typeof args.call === 'string' ? args.call : null;
		const rpArgs =
			args.args && typeof args.args === 'object' && !Array.isArray(args.args)
				? (args.args as Record<string, unknown>)
				: null;
		if (!rpCall || !rpArgs) return [];
		if (rpCall === 'read_file' && typeof rpArgs.path === 'string')
			return [{ kind: 'touch', path: rpArgs.path, operation: 'read' }];
		if (rpCall === 'apply_edits' && typeof rpArgs.path === 'string')
			return [{ kind: 'touch', path: rpArgs.path, operation: 'edit' }];
		if (rpCall === 'file_actions') {
			const action = typeof rpArgs.action === 'string' ? rpArgs.action : '';
			if (action === 'create' && typeof rpArgs.path === 'string')
				return [{ kind: 'touch', path: rpArgs.path, operation: 'write' }];
			if (action === 'delete' && typeof rpArgs.path === 'string')
				return [{ kind: 'touch', path: rpArgs.path, operation: 'delete' }];
			if (
				action === 'move' &&
				typeof rpArgs.path === 'string' &&
				typeof rpArgs.new_path === 'string'
			)
				return [{ kind: 'move', from: rpArgs.path, to: rpArgs.new_path }];
		}
	}

	if (name === 'rp_exec') {
		const cmd = typeof args.command === 'string' ? args.command : '';
		return parseRpExecActions(cmd);
	}

	if (name === 'bash') {
		const command = typeof args.command === 'string' ? args.command : '';
		return parseBashActions(command);
	}

	return [];
}
