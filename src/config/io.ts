import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAgentDir } from '@earendil-works/pi-coding-agent';

import {
	type ConfigScope,
	DEFAULT_CONFIG,
	type LiveCompactionConfig,
	type LiveCompactionPaths,
	parseConfig,
} from '@live-compaction/config/schema';

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE_NAME = 'config.json';
export const COMPACTION_PROMPT_FILE_NAME = 'compaction-prompt.md';
export const BRANCH_SUMMARY_PROMPT_FILE_NAME = 'branch-summary-prompt.md';

export async function readTextFileIfExists(
	filePath: string,
): Promise<{ exists: boolean; text?: string }> {
	try {
		return { exists: true, text: await readFile(filePath, 'utf8') };
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === 'ENOENT') return { exists: false };
		throw error;
	}
}

export async function writeTextFile(filePath: string, text: string): Promise<void> {
	const tmpPath = `${filePath}.tmp`;
	try {
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(tmpPath, text, 'utf8');
		await rename(tmpPath, filePath);
	} catch (error) {
		await rm(tmpPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

export function resolveLiveCompactionPaths(
	cwd?: string | null,
	agentDir = getAgentDir(),
): LiveCompactionPaths {
	const globalRoot = path.join(agentDir, 'extensions', 'live-compaction');
	const projectRoot = cwd ? path.join(cwd, '.pi', 'extensions', 'live-compaction') : undefined;

	return {
		global: {
			scope: 'global',
			rootDir: globalRoot,
			configPath: path.join(globalRoot, CONFIG_FILE_NAME),
			compactionPromptPath: path.join(globalRoot, COMPACTION_PROMPT_FILE_NAME),
			branchSummaryPromptPath: path.join(globalRoot, BRANCH_SUMMARY_PROMPT_FILE_NAME),
		},
		...(projectRoot
			? {
					project: {
						scope: 'project' as const,
						rootDir: projectRoot,
						configPath: path.join(projectRoot, CONFIG_FILE_NAME),
						compactionPromptPath: path.join(projectRoot, COMPACTION_PROMPT_FILE_NAME),
						branchSummaryPromptPath: path.join(projectRoot, BRANCH_SUMMARY_PROMPT_FILE_NAME),
					},
				}
			: {}),
	};
}

export function getScopedPaths(paths: LiveCompactionPaths, scope: ConfigScope) {
	if (scope === 'project') {
		if (!paths.project) {
			throw new Error('Project scope requires an active working directory');
		}
		return paths.project;
	}
	return paths.global;
}

export async function loadConfig(extensionDir = EXTENSION_DIR): Promise<LiveCompactionConfig> {
	const configPath = path.join(extensionDir, CONFIG_FILE_NAME);
	try {
		const raw = await readFile(configPath, 'utf8');
		return parseConfig(JSON.parse(raw) as unknown);
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === 'ENOENT') return structuredClone(DEFAULT_CONFIG);
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to load live-compaction config from ${configPath}: ${message}`);
	}
}

export async function loadScopedConfig(
	scope: ConfigScope,
	cwd?: string | null,
	agentDir = getAgentDir(),
): Promise<LiveCompactionConfig> {
	const scopedPaths = getScopedPaths(resolveLiveCompactionPaths(cwd, agentDir), scope);
	try {
		const raw = await readFile(scopedPaths.configPath, 'utf8');
		return parseConfig(JSON.parse(raw) as unknown);
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === 'ENOENT') return structuredClone(DEFAULT_CONFIG);
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to load live-compaction config from ${scopedPaths.configPath}: ${message}`,
		);
	}
}

export async function loadEditableScopedConfig(
	scope: ConfigScope,
	cwd?: string | null,
	agentDir = getAgentDir(),
): Promise<LiveCompactionConfig> {
	const paths = resolveLiveCompactionPaths(cwd, agentDir);
	const scopedPaths = getScopedPaths(paths, scope);
	const scopedConfig = await readTextFileIfExists(scopedPaths.configPath);
	if (scopedConfig.exists) {
		return loadScopedConfig(scope, cwd, agentDir);
	}
	if (scope === 'project') {
		return loadEffectiveConfig(cwd, agentDir);
	}
	return structuredClone(DEFAULT_CONFIG);
}

export async function saveScopedConfig(
	scope: ConfigScope,
	config: LiveCompactionConfig,
	cwd?: string | null,
	agentDir = getAgentDir(),
): Promise<string> {
	const scopedPaths = getScopedPaths(resolveLiveCompactionPaths(cwd, agentDir), scope);
	const normalized = parseConfig(config);
	await writeTextFile(scopedPaths.configPath, `${JSON.stringify(normalized, null, '\t')}\n`);
	return scopedPaths.configPath;
}

export async function loadEffectiveConfig(
	cwd?: string | null,
	agentDir = getAgentDir(),
): Promise<LiveCompactionConfig> {
	const paths = resolveLiveCompactionPaths(cwd, agentDir);
	const projectConfig = paths.project
		? await readTextFileIfExists(paths.project.configPath)
		: { exists: false };
	if (projectConfig.exists) {
		return loadScopedConfig('project', cwd, agentDir);
	}
	return loadScopedConfig('global', cwd, agentDir);
}

export async function scopeHasLocalOverrides(
	scope: ConfigScope,
	cwd?: string | null,
	agentDir = getAgentDir(),
): Promise<boolean> {
	const scopedPaths = getScopedPaths(resolveLiveCompactionPaths(cwd, agentDir), scope);
	const checks = await Promise.all([
		readTextFileIfExists(scopedPaths.configPath),
		readTextFileIfExists(scopedPaths.compactionPromptPath),
		readTextFileIfExists(scopedPaths.branchSummaryPromptPath),
	]);
	return checks.some((entry) => entry.exists);
}

export async function resetLiveCompactionScope(
	scope: ConfigScope,
	cwd?: string | null,
	agentDir = getAgentDir(),
): Promise<string[]> {
	const scopedPaths = getScopedPaths(resolveLiveCompactionPaths(cwd, agentDir), scope);
	const removedPaths = [
		scopedPaths.configPath,
		scopedPaths.compactionPromptPath,
		scopedPaths.branchSummaryPromptPath,
	];
	await Promise.all(removedPaths.map((filePath) => rm(filePath, { force: true })));
	return removedPaths;
}
