/**
 * Regression test for the <files-touched> rendering bug.
 *
 * Previously `formatManifestOperations` read non-existent boolean properties
 * (`file.read`, `file.written`, …) and `renderFilesTouchedManifestBlock`
 * referenced `f.relativePath` which also doesn't exist on FilesTouchedEntry.
 * Result: rendered block was rows of `undefined`.
 *
 * The fix uses `file.operations.has(...)` against the real
 * Set<FileTouchOperation> shape and `file.displayPath || file.path` for the
 * label.
 */

import { describe, expect, it } from 'vitest';

import type { FilesTouchedEntry } from '@live-compaction/files-touched';
import {
	formatManifestOperations,
	renderFilesTouchedManifestBlock,
} from '@live-compaction/files-touched-manifest';

function entry(
	displayPath: string,
	ops: Array<'read' | 'write' | 'edit' | 'move' | 'delete'>,
): FilesTouchedEntry {
	return {
		path: `/abs/${displayPath}`,
		displayPath,
		operations: new Set(ops),
		lastTimestamp: 0,
	};
}

describe('renderFilesTouchedManifestBlock', () => {
	it('renders one row per file, no `undefined` tokens', () => {
		const block = renderFilesTouchedManifestBlock([
			entry('README.md', ['read', 'edit']),
			entry('CHANGELOG.md', ['write']),
			entry('src/old.ts', ['delete']),
		]);
		expect(block).not.toContain('undefined');
		expect(block).toContain('RE  README.md');
		expect(block).toContain('W  CHANGELOG.md');
		expect(block).toContain('D  src/old.ts');
	});

	it('returns empty string when there are no entries', () => {
		expect(renderFilesTouchedManifestBlock([])).toBe('');
	});

	it('skips rows where ops are empty (defensive)', () => {
		const block = renderFilesTouchedManifestBlock([
			entry('README.md', []),
			entry('CHANGELOG.md', ['write']),
		]);
		expect(block).not.toContain('README.md');
		expect(block).toContain('W  CHANGELOG.md');
	});

	it('formatManifestOperations preserves operation order R/W/E/M/D', () => {
		expect(formatManifestOperations(entry('x', ['delete', 'read', 'edit', 'move', 'write']))).toBe(
			'RWEMD',
		);
	});
});
