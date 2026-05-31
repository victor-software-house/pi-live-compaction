import * as fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

export function uniqStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

export function normalizePathSeparators(value: string): string {
	return value.replace(/\\/g, '/');
}

function normalizeSegments(value: string): string {
	const normalized = normalizePathSeparators(value);
	const segments: string[] = [];
	for (const segment of normalized.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') {
			if (segments.length > 0 && segments[segments.length - 1] !== '..') {
				segments.pop();
				continue;
			}
		}
		segments.push(segment);
	}
	return segments.join('/');
}

export function normalizeRelativePath(value: string): string {
	return normalizeSegments(value.trim());
}

export function normalizeAbsolutePath(value: string): string {
	const normalized = normalizePathSeparators(value.trim());
	const windowsMatch = normalized.match(/^([A-Za-z]:)(?:\/(.*))?$/);
	if (windowsMatch) {
		const segments = normalizeSegments(windowsMatch[2] ?? '');
		return segments ? `${windowsMatch[1]}/${segments}` : `${windowsMatch[1]}/`;
	}
	const segments = normalizeSegments(normalized);
	return segments ? `/${segments}` : '/';
}

export function isAbsolutePath(value: string): boolean {
	const normalized = normalizePathSeparators(value.trim());
	return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
}

export function stripReadSliceSuffix(value: string): string {
	return value.replace(/:(\d+)-(\d+)$/, '');
}

// ---------------------------------------------------------------------------
// Root-prefixed path parsing
// ---------------------------------------------------------------------------

type ParsedRootPrefixedPath = {
	root: string;
	relativePath: string;
};

type RootInfo = {
	absolutePath: string;
	name: string;
};

export function parseRootPrefixedPath(value: string): ParsedRootPrefixedPath | null {
	const normalized = normalizePathSeparators(value.trim());
	if (!normalized || isAbsolutePath(normalized)) return null;
	const match = normalized.match(/^([^/:]+):(.*)$/);
	if (!match) return null;
	const relativePath = normalizeRelativePath(match[2] ?? '');
	if (!relativePath) return null;
	return { root: match[1], relativePath };
}

function splitPathSegments(value: string): string[] {
	return normalizePathSeparators(value).split('/').filter(Boolean);
}

function deriveRootFromAbsoluteAndRelative(absPath: string, relativePath: string): string | null {
	const absSegments = splitPathSegments(normalizeAbsolutePath(absPath));
	const relSegments = splitPathSegments(normalizeRelativePath(relativePath));
	if (relSegments.length === 0 || absSegments.length <= relSegments.length) return null;
	for (let index = 1; index <= relSegments.length; index += 1) {
		if (absSegments[absSegments.length - index] !== relSegments[relSegments.length - index]) {
			return null;
		}
	}
	return `/${absSegments.slice(0, absSegments.length - relSegments.length).join('/')}`;
}

export function inferRootMappings(paths: string[]): Map<string, string> {
	const absolutePaths = uniqStrings(
		paths.filter((v) => isAbsolutePath(v)).map((v) => normalizeAbsolutePath(v)),
	);
	const rootRefs = paths
		.map((v) => parseRootPrefixedPath(v))
		.filter((v): v is ParsedRootPrefixedPath => Boolean(v));
	const scoresByRoot = new Map<string, Map<string, number>>();

	for (const ref of rootRefs) {
		const rootScores = scoresByRoot.get(ref.root) ?? new Map<string, number>();
		for (const absolutePath of absolutePaths) {
			const candidateRoot = deriveRootFromAbsoluteAndRelative(absolutePath, ref.relativePath);
			if (!candidateRoot) continue;
			const bonus = path.basename(candidateRoot) === ref.root ? 2 : 1;
			rootScores.set(candidateRoot, (rootScores.get(candidateRoot) ?? 0) + bonus);
		}
		scoresByRoot.set(ref.root, rootScores);
	}

	const out = new Map<string, string>();
	for (const [root, scores] of scoresByRoot) {
		const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]);
		if (ranked.length === 0) continue;
		if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) continue;
		out.set(root, ranked[0][0]);
	}
	return out;
}

export function getCurrentRootInfo(cwd: string | null | undefined): RootInfo | null {
	if (!cwd || !isAbsolutePath(cwd)) return null;
	const absolutePath = normalizeAbsolutePath(cwd);
	return { absolutePath, name: path.basename(absolutePath) };
}

export function buildRootMappings(
	paths: string[],
	cwd: string | null | undefined,
): Map<string, string> {
	const mappings = inferRootMappings(paths);
	const currentRoot = getCurrentRootInfo(cwd);
	if (currentRoot) {
		mappings.set(currentRoot.name, currentRoot.absolutePath);
	}
	return mappings;
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

function isWithinPath(filePath: string, rootPath: string): boolean {
	return filePath === rootPath || filePath.startsWith(`${rootPath}/`);
}

function findRootForAbsolutePath(
	absolutePath: string,
	rootMappings: Map<string, string>,
): { root: string; relativePath: string } | null {
	const normalizedAbsolutePath = normalizeAbsolutePath(absolutePath);
	let bestMatch: { root: string; relativePath: string; rootPathLength: number } | null = null;
	for (const [root, rootPath] of rootMappings) {
		if (!isWithinPath(normalizedAbsolutePath, rootPath) || normalizedAbsolutePath === rootPath) {
			continue;
		}
		const relativePath = normalizedAbsolutePath.slice(rootPath.length + 1);
		if (!relativePath) continue;
		if (!bestMatch || rootPath.length > bestMatch.rootPathLength) {
			bestMatch = { root, relativePath, rootPathLength: rootPath.length };
		}
	}
	return bestMatch ? { root: bestMatch.root, relativePath: bestMatch.relativePath } : null;
}

export function normalizeTrackedPath(
	pathValue: string,
	rootMappings: Map<string, string>,
	cwd: string | null | undefined,
): string {
	const strippedPath = stripReadSliceSuffix(pathValue.trim());
	if (!strippedPath) return '';

	const rootPrefixed = parseRootPrefixedPath(strippedPath);
	if (rootPrefixed) return `${rootPrefixed.root}:${rootPrefixed.relativePath}`;

	if (isAbsolutePath(strippedPath)) {
		const rooted = findRootForAbsolutePath(strippedPath, rootMappings);
		return rooted ? `${rooted.root}:${rooted.relativePath}` : normalizeAbsolutePath(strippedPath);
	}

	const currentRoot = getCurrentRootInfo(cwd);
	let relativePath = strippedPath;
	if (
		currentRoot &&
		(relativePath === currentRoot.name || relativePath.startsWith(`${currentRoot.name}/`))
	) {
		relativePath =
			relativePath === currentRoot.name ? '' : relativePath.slice(currentRoot.name.length + 1);
	}

	const normalizedRelativePath = normalizeRelativePath(relativePath);
	if (!normalizedRelativePath) return currentRoot?.absolutePath ?? '';

	const rootedRelative = [...rootMappings.keys()]
		.sort((left, right) => right.length - left.length)
		.find((root) => normalizedRelativePath.startsWith(`${root}/`));
	if (rootedRelative) {
		return `${rootedRelative}:${normalizedRelativePath.slice(rootedRelative.length + 1)}`;
	}

	return currentRoot ? `${currentRoot.name}:${normalizedRelativePath}` : normalizedRelativePath;
}

export function resolveCanonicalPath(
	canonicalPath: string,
	rootMappings: Map<string, string>,
	cwd: string | null | undefined,
): string {
	if (!canonicalPath) return canonicalPath;

	if (isAbsolutePath(canonicalPath)) return normalizeAbsolutePath(canonicalPath);

	const rootPrefixed = parseRootPrefixedPath(canonicalPath);
	if (rootPrefixed) {
		const currentRoot = getCurrentRootInfo(cwd);
		const rootPath =
			rootMappings.get(rootPrefixed.root) ??
			(currentRoot?.name === rootPrefixed.root ? currentRoot.absolutePath : null);
		if (!rootPath) return canonicalPath;
		return `${rootPath}/${rootPrefixed.relativePath}`;
	}

	const normalizedRelativePath = normalizeRelativePath(canonicalPath);
	if (!normalizedRelativePath) return getCurrentRootInfo(cwd)?.absolutePath ?? canonicalPath;

	const currentRoot = getCurrentRootInfo(cwd);
	return currentRoot
		? `${currentRoot.absolutePath}/${normalizedRelativePath}`
		: normalizedRelativePath;
}

function fallbackDisplayPath(canonicalPath: string): string {
	const rootPrefixed = parseRootPrefixedPath(canonicalPath);
	if (!rootPrefixed) return canonicalPath;
	return `${rootPrefixed.root}/${rootPrefixed.relativePath}`;
}

function findRepoRootForDisplay(absolutePath: string, currentRoot: string | null): string | null {
	const normalizedAbsolutePath = normalizeAbsolutePath(absolutePath);
	if (currentRoot && isWithinPath(normalizedAbsolutePath, currentRoot)) return currentRoot;

	let candidate = normalizedAbsolutePath;
	try {
		const stats = fs.existsSync(candidate) ? fs.statSync(candidate) : null;
		if (stats?.isFile()) {
			candidate = normalizeAbsolutePath(path.dirname(candidate));
		}
	} catch {
		// fall through with the original path-derived candidate
	}

	while (true) {
		if (fs.existsSync(path.join(candidate, '.git'))) return candidate;
		const parent = normalizeAbsolutePath(path.dirname(candidate));
		if (parent === candidate) return null;
		candidate = parent;
	}
}

export function displayPathForTrackedPath(
	canonicalPath: string,
	resolvedPath: string,
	cwd: string | null | undefined,
): string {
	if (!resolvedPath || !isAbsolutePath(resolvedPath)) {
		return fallbackDisplayPath(canonicalPath);
	}

	const currentRoot = getCurrentRootInfo(cwd);
	if (currentRoot && isWithinPath(resolvedPath, currentRoot.absolutePath)) {
		return resolvedPath.slice(currentRoot.absolutePath.length + 1);
	}

	const repoRoot = findRepoRootForDisplay(resolvedPath, currentRoot?.absolutePath ?? null);
	if (!repoRoot || !isWithinPath(resolvedPath, repoRoot)) {
		return fallbackDisplayPath(canonicalPath) || resolvedPath;
	}

	const relativePath = resolvedPath.slice(repoRoot.length + 1);
	return relativePath ? `${path.basename(repoRoot)}/${relativePath}` : path.basename(repoRoot);
}

export function resolveMoveRedirect(pathValue: string, redirects: Map<string, string>): string {
	let current = pathValue;
	const seen = new Set<string>();
	while (redirects.has(current) && !seen.has(current)) {
		seen.add(current);
		current = redirects.get(current) ?? current;
	}
	return current;
}
