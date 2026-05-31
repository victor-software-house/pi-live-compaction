/**
 * Minimal hand-built fixture: one user/assistant exchange in the discarded
 * span and one fresh user message in the kept tail. No previous summary, no
 * files-touched, no focus.
 *
 * Used for the simplest "the engine renders all blocks correctly and the
 * latest user ask appears" snapshot.
 */

import type { Message } from "@earendil-works/pi-ai";

export const minimalDiscarded: Message[] = [
	{
		role: "user",
		content: [{ type: "text", text: "Original ask: refactor X" }],
		timestamp: 1000,
	},
	{
		role: "assistant",
		content: [{ type: "text", text: "On it. Reading X first." }],
		api: "anthropic",
		provider: "anthropic",
		model: "claude-sonnet-4-20250514",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: 2000,
	},
];

export const minimalKeptTail: Message[] = [
	{
		role: "user",
		content: [
			{
				type: "text",
				text: "Actually pivot: do Y first instead of X.",
			},
		],
		timestamp: 3000,
	},
];
