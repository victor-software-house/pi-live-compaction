/**
 * Files-touched manifest renderer.
 *
 * Pi-runtime-free so it can be imported from tests, the preview CLI, and
 * any consumer that doesn't pull `@earendil-works/pi-tui`.
 *
 * `FilesTouchedEntry.operations` is a `Set<FileTouchOperation>` from
 * files-touched-core. The previous renderer in index.ts read non-existent
 * boolean properties (`file.read`, `file.written`, …) and `f.relativePath`
 * which doesn't exist on the entry shape — that's why the rendered block
 * came out as rows of `undefined` in real sessions.
 */

import type { FilesTouchedEntry } from './files-touched';

export const FILES_TOUCHED_HEADING = '## Files touched';
export const FILES_TOUCHED_LEGEND = 'R=read, W=write, E=edit, M=move/rename, D=delete';

export function formatManifestOperations(file: FilesTouchedEntry): string {
	const ops: string[] = [];
	if (file.operations.has('read')) ops.push('R');
	if (file.operations.has('write')) ops.push('W');
	if (file.operations.has('edit')) ops.push('E');
	if (file.operations.has('move')) ops.push('M');
	if (file.operations.has('delete')) ops.push('D');
	return ops.join('');
}

export function renderFilesTouchedManifestBlock(
	files: FilesTouchedEntry[],
	heading = FILES_TOUCHED_HEADING,
): string {
	if (files.length === 0) return '';

	const lines = files
		.map((f) => {
			const ops = formatManifestOperations(f);
			const displayPath = f.displayPath || f.path;
			if (!ops || !displayPath) return null;
			return `${ops}  ${displayPath}`;
		})
		.filter((line): line is string => line !== null);

	if (lines.length === 0) return '';

	return [heading, FILES_TOUCHED_LEGEND, '', '```text', ...lines, '```'].join('\n');
}
