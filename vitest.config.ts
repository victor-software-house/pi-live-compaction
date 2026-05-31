import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		// Golden snapshots live next to the test files in test/snapshots/.
		resolveSnapshotPath: (testPath, snapExtension) => {
			const filename = testPath.split("/").pop() ?? "test";
			return `${process.cwd()}/test/snapshots/${filename}${snapExtension}`;
		},
	},
});
