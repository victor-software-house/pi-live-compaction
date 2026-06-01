import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
	},
	format: 'esm',
	platform: 'node',
	target: 'node24',
	sourcemap: true,
	clean: true,
	hash: false,
	unbundle: true,
	dts: true,
	publint: true,
	unused: true,
	deps: {
		neverBundle: [
			'@earendil-works/pi-ai',
			'@earendil-works/pi-coding-agent',
			'@earendil-works/pi-tui',
			'pi-template-kit',
			'dedent',
		],
	},
});
