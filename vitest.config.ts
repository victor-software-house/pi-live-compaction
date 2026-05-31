import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		include: ['test/**/*.test.ts'],
		resolveSnapshotPath: (testPath, snapExtension) => {
			const filename = testPath.split('/').pop() ?? 'test';
			return `${process.cwd()}/test/snapshots/${filename}${snapExtension}`;
		},
	},
});
