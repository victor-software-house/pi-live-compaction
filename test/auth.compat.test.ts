import { describe, expect, it } from "vitest";

import { COMPACTION_ATTEMPT_CUSTOM_TYPE } from "../extensions/live-compaction/attempt-entry";
import { DEFAULT_CONFIG } from "../extensions/live-compaction/config";
import { runLiveCompaction } from "../extensions/live-compaction/index";
import { SYSTEM_PROMPT } from "../extensions/live-compaction/summary-stream";

const model = {
	provider: "custom-provider",
	id: "custom-model",
	api: "custom-api",
	name: "Custom Model",
	baseUrl: "https://example.test",
	maxTokens: 64000,
	contextWindow: 200000,
};

const codexModel = {
	provider: "openai-codex",
	id: "gpt-5-codex",
	api: "openai-codex-responses",
	name: "GPT-5 Codex",
	baseUrl: "https://example.test",
	maxTokens: 64000,
	contextWindow: 200000,
};

function assistantSummary(text: string): Record<string, unknown> {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "custom-api",
		provider: "custom-provider",
		model: "custom-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("registered provider request compatibility", () => {
	it("uses provider-registered streamSimple before raw completeSimple", async () => {
		let streamSimpleCalled = false;
		let fallbackCompleteCalled = false;
		let capturedOptions: Record<string, unknown> | undefined;

		const result = await runLiveCompaction(
			{
				signal: new AbortController().signal,
				customInstructions: undefined,
				branchEntries: [
					{
						id: "m1",
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					},
				],
				preparation: {
					messagesToSummarize: [
						{
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					],
					turnPrefixMessages: [],
					firstKeptEntryId: "m1",
					previousSummary: undefined,
					tokensBefore: 123,
					settings: { reserveTokens: 4000 },
				},
			} as never,
			{
				hasUI: false,
				ui: { notify: () => undefined },
				model,
				cwd: "/tmp",
				modelRegistry: {
					getAll: () => [model],
					registeredProviders: new Map([
						[
							"custom-provider",
							{
								streamSimple: (
									_model: unknown,
									_context: unknown,
									options: unknown,
								) => {
									streamSimpleCalled = true;
									capturedOptions = options as Record<string, unknown>;
									return {
										result: async () => assistantSummary("summary from provider stream"),
									};
								},
							},
						],
					]),
					getApiKeyAndHeaders: async () => ({
						ok: true,
						apiKey: "provider-token",
						headers: { "x-provider-header": "yes" },
					}),
				},
			} as never,
			{
				complete: async () => {
					fallbackCompleteCalled = true;
					return assistantSummary("fallback summary");
				},
				streamSimple: (() => {
					throw new Error("default stream should not be used when provider stream exists");
				}) as never,
				collectFilesTouched: () => [],
				loadConfig: async () => DEFAULT_CONFIG,
				loadCompactionPrompt: async () => "# What to include",
				loadBranchSummaryPrompt: async () => "unused",
				loadCompactionTemplate: async () => null,
				resolvePaths: () => ({
					global: { compactionPromptPath: "/tmp/compaction-prompt.md" },
					project: undefined,
				}),
			} as never,
		);

		expect("compaction" in result!).toBe(true);
		if (!result || !("compaction" in result)) throw new Error("expected compaction");
		expect(result.compaction.summary).toBe("summary from provider stream");
		expect(streamSimpleCalled).toBe(true);
		expect(fallbackCompleteCalled).toBe(false);
		expect(capturedOptions).toMatchObject({
			apiKey: "provider-token",
			headers: { "x-provider-header": "yes" },
			maxTokens: 4000,
		});
	});

	it("streams partial compaction text to the UI while preserving the final summary", async () => {
		const widgetCalls: unknown[] = [];
		const statusCalls: Array<string | undefined> = [];
		const workingMessages: Array<string | undefined> = [];

		const result = await runLiveCompaction(
			{
				signal: new AbortController().signal,
				customInstructions: undefined,
				branchEntries: [
					{
						id: "m1",
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					},
				],
				preparation: {
					messagesToSummarize: [
						{
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					],
					turnPrefixMessages: [],
					firstKeptEntryId: "m1",
					previousSummary: undefined,
					tokensBefore: 123,
					settings: { reserveTokens: 4000 },
				},
			} as never,
			{
				hasUI: true,
				ui: {
					notify: () => undefined,
					setWidget: (_key: string, content: unknown) => {
						widgetCalls.push(content);
					},
					setStatus: (_key: string, text: string | undefined) => {
						statusCalls.push(text);
					},
					setWorkingMessage: (message?: string) => {
						workingMessages.push(message);
					},
				},
				model,
				cwd: "/tmp",
				modelRegistry: {
					getAll: () => [model],
					registeredProviders: new Map([
						[
							"custom-provider",
							{
								streamSimple: () => {
									const final = assistantSummary("partial summary final");
									return {
										async *[Symbol.asyncIterator]() {
											yield { type: "start", partial: assistantSummary("") };
											yield {
												type: "text_delta",
												contentIndex: 0,
												delta: "partial summary",
												partial: assistantSummary("partial summary"),
											};
											yield { type: "done", reason: "stop", message: final };
										},
										result: async () => final,
									};
								},
							},
						],
					]),
					getApiKeyAndHeaders: async () => ({
						ok: true,
						apiKey: "provider-token",
						headers: { "x-provider-header": "yes" },
					}),
				},
			} as never,
			{
				complete: async () => assistantSummary("fallback summary"),
				streamSimple: (() => {
					throw new Error("default stream should not be used when provider stream exists");
				}) as never,
				collectFilesTouched: () => [],
				loadConfig: async () => DEFAULT_CONFIG,
				loadCompactionPrompt: async () => "# What to include",
				loadBranchSummaryPrompt: async () => "unused",
				loadCompactionTemplate: async () => null,
				resolvePaths: () => ({
					global: { compactionPromptPath: "/tmp/compaction-prompt.md" },
					project: undefined,
				}),
			} as never,
		);

		expect("compaction" in result!).toBe(true);
		if (!result || !("compaction" in result)) throw new Error("expected compaction");
		expect(result.compaction.summary).toBe("partial summary final");
		expect(widgetCalls.some((content) => typeof content === "function")).toBe(true);
		expect(widgetCalls.at(-1)).toBeUndefined();
		expect(statusCalls.at(-1)).toBeUndefined();
		expect(workingMessages.at(-1)).toBeUndefined();
	});

	it("keeps streamed compaction text when the provider stream fails late", async () => {
		const result = await runLiveCompaction(
			{
				signal: new AbortController().signal,
				customInstructions: undefined,
				branchEntries: [
					{
						id: "m1",
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					},
				],
				preparation: {
					messagesToSummarize: [
						{
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					],
					turnPrefixMessages: [],
					firstKeptEntryId: "m1",
					previousSummary: undefined,
					tokensBefore: 123,
					settings: { reserveTokens: 4000 },
				},
			} as never,
			{
				hasUI: false,
				ui: { notify: () => undefined },
				model,
				cwd: "/tmp",
				modelRegistry: {
					getAll: () => [model],
					registeredProviders: new Map([
						[
							"custom-provider",
							{
								streamSimple: () => ({
									async *[Symbol.asyncIterator]() {
										yield {
											type: "text_delta",
											contentIndex: 0,
											delta: "fantastic partial summary",
											partial: assistantSummary("fantastic partial summary"),
										};
										throw new Error("WebSocket error");
									},
									result: async () => assistantSummary("should not use result"),
								}),
							},
						],
					]),
					getApiKeyAndHeaders: async () => ({ ok: true }),
				},
			} as never,
			{
				complete: async () => assistantSummary("fallback summary"),
				streamSimple: (() => {
					throw new Error("default stream should not be used when provider stream exists");
				}) as never,
				collectFilesTouched: () => [],
				loadConfig: async () => DEFAULT_CONFIG,
				loadCompactionPrompt: async () => "# What to include",
				loadBranchSummaryPrompt: async () => "unused",
				loadCompactionTemplate: async () => null,
				resolvePaths: () => ({
					global: { compactionPromptPath: "/tmp/compaction-prompt.md" },
					project: undefined,
				}),
			} as never,
		);

		expect("compaction" in result!).toBe(true);
		if (!result || !("compaction" in result)) throw new Error("expected compaction");
		expect(result.compaction.summary).toBe("fantastic partial summary");
	});

	it("keeps streamed compaction text when the provider emits an error event", async () => {
		const result = await runLiveCompaction(
			{
				signal: new AbortController().signal,
				customInstructions: undefined,
				branchEntries: [
					{
						id: "m1",
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					},
				],
				preparation: {
					messagesToSummarize: [
						{
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					],
					turnPrefixMessages: [],
					firstKeptEntryId: "m1",
					previousSummary: undefined,
					tokensBefore: 123,
					settings: { reserveTokens: 4000 },
				},
			} as never,
			{
				hasUI: false,
				ui: { notify: () => undefined },
				model,
				cwd: "/tmp",
				modelRegistry: {
					getAll: () => [model],
					registeredProviders: new Map([
						[
							"custom-provider",
							{
								streamSimple: () => ({
									async *[Symbol.asyncIterator]() {
										yield {
											type: "text_delta",
											contentIndex: 0,
											delta: "summary before error event",
											partial: assistantSummary("summary before error event"),
										};
										yield {
											type: "error",
											error: {
												...assistantSummary(""),
												stopReason: "error",
												errorMessage: "WebSocket error",
											},
										};
									},
									result: async () => assistantSummary("should not use result"),
								}),
							},
						],
					]),
					getApiKeyAndHeaders: async () => ({ ok: true }),
				},
			} as never,
			{
				complete: async () => assistantSummary("fallback summary"),
				streamSimple: (() => {
					throw new Error("default stream should not be used when provider stream exists");
				}) as never,
				collectFilesTouched: () => [],
				loadConfig: async () => DEFAULT_CONFIG,
				loadCompactionPrompt: async () => "# What to include",
				loadBranchSummaryPrompt: async () => "unused",
				loadCompactionTemplate: async () => null,
				resolvePaths: () => ({
					global: { compactionPromptPath: "/tmp/compaction-prompt.md" },
					project: undefined,
				}),
			} as never,
		);

		expect("compaction" in result!).toBe(true);
		if (!result || !("compaction" in result)) throw new Error("expected compaction");
		expect(result.compaction.summary).toBe("summary before error event");
	});

	it("falls back to the built-in streamSimple so built-in providers can stream UI progress", async () => {
		let fallbackCompleteCalled = false;
		let defaultStreamCalled = false;
		const widgetCalls: unknown[] = [];

		const result = await runLiveCompaction(
			{
				signal: new AbortController().signal,
				customInstructions: undefined,
				branchEntries: [
					{
						id: "m1",
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					},
				],
				preparation: {
					messagesToSummarize: [
						{
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					],
					turnPrefixMessages: [],
					firstKeptEntryId: "m1",
					previousSummary: undefined,
					tokensBefore: 123,
					settings: { reserveTokens: 4000 },
				},
			} as never,
			{
				hasUI: true,
				ui: {
					notify: () => undefined,
					setWidget: (_key: string, content: unknown) => {
						widgetCalls.push(content);
					},
					setStatus: () => undefined,
					setWorkingMessage: () => undefined,
				},
				model,
				cwd: "/tmp",
				modelRegistry: {
					getAll: () => [model],
					registeredProviders: new Map(),
					getApiKeyAndHeaders: async () => ({
						ok: true,
						apiKey: "provider-token",
						headers: { "x-provider-header": "yes" },
					}),
				},
			} as never,
			{
				complete: async () => {
					fallbackCompleteCalled = true;
					return assistantSummary("fallback summary");
				},
				streamSimple: (() => {
					defaultStreamCalled = true;
					const final = assistantSummary("default stream final");
					return {
						async *[Symbol.asyncIterator]() {
							yield { type: "start", partial: assistantSummary("") };
							yield {
								type: "text_delta",
								contentIndex: 0,
								delta: "default stream partial",
								partial: assistantSummary("default stream partial"),
							};
							yield { type: "done", reason: "stop", message: final };
						},
						result: async () => final,
					};
				}) as never,
				collectFilesTouched: () => [],
				loadConfig: async () => DEFAULT_CONFIG,
				loadCompactionPrompt: async () => "# What to include",
				loadBranchSummaryPrompt: async () => "unused",
				loadCompactionTemplate: async () => null,
				resolvePaths: () => ({
					global: { compactionPromptPath: "/tmp/compaction-prompt.md" },
					project: undefined,
				}),
			} as never,
		);

		expect("compaction" in result!).toBe(true);
		if (!result || !("compaction" in result)) throw new Error("expected compaction");
		expect(result.compaction.summary).toBe("default stream final");
		expect(defaultStreamCalled).toBe(true);
		expect(fallbackCompleteCalled).toBe(false);
		expect(widgetCalls.some((content) => typeof content === "function")).toBe(true);
	});

	it("forces SSE for Codex Responses compaction calls", async () => {
		let capturedOptions: Record<string, unknown> | undefined;
		const appendedEntries: Array<{ customType: string; data: any }> = [];

		const result = await runLiveCompaction(
			{
				signal: new AbortController().signal,
				customInstructions: "keep focus text",
				branchEntries: [
					{
						id: "m1",
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					},
				],
				preparation: {
					messagesToSummarize: [
						{
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					],
					turnPrefixMessages: [],
					firstKeptEntryId: "m1",
					previousSummary: undefined,
					tokensBefore: 123,
					settings: { reserveTokens: 4000 },
				},
			} as never,
			{
				hasUI: false,
				ui: { notify: () => undefined },
				model: codexModel,
				cwd: "/tmp",
				modelRegistry: {
					getAll: () => [codexModel],
					registeredProviders: new Map(),
					getApiKeyAndHeaders: async () => ({ ok: true }),
				},
			} as never,
			{
				complete: async () => assistantSummary("fallback summary"),
				streamSimple: ((_model: unknown, _context: unknown, options: unknown) => {
					capturedOptions = options as Record<string, unknown>;
					return {
						result: async () => assistantSummary("codex summary"),
					};
				}) as never,
				collectFilesTouched: () => [],
				loadConfig: async () => ({ ...DEFAULT_CONFIG, defaultPreset: "current" }),
				loadCompactionPrompt: async () => "# What to include",
				loadBranchSummaryPrompt: async () => "unused",
				loadCompactionTemplate: async () => null,
				resolvePaths: () => ({
					global: { compactionPromptPath: "/tmp/compaction-prompt.md" },
					project: undefined,
				}),
				appendEntry: (customType: string, data: unknown) => {
					appendedEntries.push({ customType, data });
				},
			} as never,
		);

		expect("compaction" in result!).toBe(true);
		if (!result || !("compaction" in result)) throw new Error("expected compaction");
		expect(result.compaction.summary).toBe("codex summary");
		expect(capturedOptions).toMatchObject({ transport: "sse" });
		expect(result.compaction.details).toMatchObject({
			focusInput: "keep focus text",
			focusText: "keep focus text",
			transport: "sse",
		});
		expect(appendedEntries.every((entry) => entry.customType === COMPACTION_ATTEMPT_CUSTOM_TYPE)).toBe(true);
		expect(appendedEntries.map((entry) => entry.data.event)).toEqual([
			"start",
			"request_rendered",
			"success",
		]);
		expect(appendedEntries[0].data).toMatchObject({
			focusInput: "keep focus text",
			focusText: "keep focus text",
			tokensBefore: 123,
			firstKeptEntryId: "m1",
		});
		const requestEntry = appendedEntries[1].data;
		expect(requestEntry.systemPrompt).toBe(SYSTEM_PROMPT);
		expect(requestEntry.renderedPrompt).toContain("<focus>\nkeep focus text\n</focus>");
			expect(requestEntry.systemPromptChars).toBe(SYSTEM_PROMPT.length);
		expect(requestEntry.promptChars).toBe(requestEntry.renderedPrompt.length);
		expect(requestEntry.renderedPromptChars).toBe(requestEntry.renderedPrompt.length);
		expect(requestEntry.systemPromptSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(requestEntry.renderedPromptSha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it("does not set transport for non-Codex providers", async () => {
		let capturedOptions: Record<string, unknown> | undefined;

		const result = await runLiveCompaction(
			{
				signal: new AbortController().signal,
				customInstructions: undefined,
				branchEntries: [
					{
						id: "m1",
						type: "message",
						message: {
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					},
				],
				preparation: {
					messagesToSummarize: [
						{
							role: "user",
							content: [{ type: "text", text: "summarize this" }],
							timestamp: Date.now(),
						},
					],
					turnPrefixMessages: [],
					firstKeptEntryId: "m1",
					previousSummary: undefined,
					tokensBefore: 123,
					settings: { reserveTokens: 4000 },
				},
			} as never,
			{
				hasUI: false,
				ui: { notify: () => undefined },
				model,
				cwd: "/tmp",
				modelRegistry: {
					getAll: () => [model],
					registeredProviders: new Map(),
					getApiKeyAndHeaders: async () => ({ ok: true }),
				},
			} as never,
			{
				complete: async () => assistantSummary("fallback summary"),
				streamSimple: ((_model: unknown, _context: unknown, options: unknown) => {
					capturedOptions = options as Record<string, unknown>;
					return {
						result: async () => assistantSummary("non-codex summary"),
					};
				}) as never,
				collectFilesTouched: () => [],
				loadConfig: async () => DEFAULT_CONFIG,
				loadCompactionPrompt: async () => "# What to include",
				loadBranchSummaryPrompt: async () => "unused",
				loadCompactionTemplate: async () => null,
				resolvePaths: () => ({
					global: { compactionPromptPath: "/tmp/compaction-prompt.md" },
					project: undefined,
				}),
			} as never,
		);

		expect("compaction" in result!).toBe(true);
		if (!result || !("compaction" in result)) throw new Error("expected compaction");
		expect(result.compaction.summary).toBe("non-codex summary");
		expect(capturedOptions).not.toHaveProperty("transport");
		expect(result.compaction.details).not.toHaveProperty("transport");
	});

});
