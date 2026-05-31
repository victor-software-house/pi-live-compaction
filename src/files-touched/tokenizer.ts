// ---------------------------------------------------------------------------
// Shell tokenizer — splits a shell command string into token arrays
// ---------------------------------------------------------------------------

export function tokenizeShellCommand(cmd: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;
	let escaped = false;

	const flush = () => {
		if (current) {
			tokens.push(current);
			current = '';
		}
	};

	for (let index = 0; index < cmd.length; index += 1) {
		const char = cmd[index];
		const next = cmd[index + 1] ?? '';

		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (quote) {
			if (char === '\\') {
				escaped = true;
				continue;
			}
			if (char === quote) {
				quote = null;
				continue;
			}
			current += char;
			continue;
		}
		if (char === '\\') {
			escaped = true;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			flush();
			continue;
		}
		if (char === ';') {
			flush();
			tokens.push(char);
			continue;
		}
		if ((char === '&' || char === '|') && next === char) {
			flush();
			tokens.push(char + next);
			index += 1;
			continue;
		}
		if (char === '&' || char === '|') {
			flush();
			tokens.push(char);
			continue;
		}
		current += char;
	}

	flush();
	return tokens;
}

export function splitShellCommands(cmd: string): string[][] {
	const commands: string[][] = [];
	let current: string[] = [];
	for (const token of tokenizeShellCommand(cmd)) {
		if (token === ';' || token === '&&' || token === '||' || token === '|' || token === '&') {
			if (current.length > 0) {
				commands.push(current);
				current = [];
			}
			continue;
		}
		current.push(token);
	}
	if (current.length > 0) commands.push(current);
	return commands;
}

export function stripShellCommandWrappers(tokens: string[]): string[] {
	let current = [...tokens];
	while (current.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(current[0])) {
		current = current.slice(1);
	}
	for (const wrapper of ['command', 'env', 'noglob', 'sudo']) {
		if (current[0] !== wrapper) continue;
		current = current.slice(1);
		while (current.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(current[0])) {
			current = current.slice(1);
		}
	}
	return current;
}

export function extractShellOperands(tokens: string[]): string[] {
	const operands: string[] = [];
	let allowFlags = true;
	for (const token of tokens) {
		if (allowFlags && token === '--') {
			allowFlags = false;
			continue;
		}
		if (allowFlags && token.startsWith('-')) continue;
		operands.push(token);
	}
	return operands;
}
