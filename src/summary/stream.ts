import type {
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	SimpleStreamOptions,
} from '@earendil-works/pi-ai';

import type { ResolvedSummarizer, RunDeps, SummaryProgress } from '@live-compaction/types';

export async function completeWithResolvedSummarizer(
	summarizer: ResolvedSummarizer,
	context: Context,
	options: SimpleStreamOptions,
	deps: RunDeps,
	progress?: SummaryProgress,
	tokensBefore = 0,
): Promise<AssistantMessage> {
	const modelLabel = `${summarizer.model.provider}/${summarizer.model.id}`;
	progress?.start(modelLabel, tokensBefore);
	try {
		const streamFactory = summarizer.streamSimple ?? deps.streamSimple;
		if (!streamFactory) {
			return await deps.complete(summarizer.model, context, options);
		}

		const stream = streamFactory(summarizer.model, context, options);
		const maybeAsyncStream = stream as ReturnType<typeof streamFactory> & {
			[Symbol.asyncIterator]?: () => AsyncIterator<AssistantMessageEvent>;
		};
		if (!maybeAsyncStream[Symbol.asyncIterator]) {
			return await stream.result();
		}

		let streamedText = '';
		let finalMessage: AssistantMessage | undefined;
		let errorMessage: AssistantMessage | undefined;

		try {
			for await (const event of maybeAsyncStream as AsyncIterable<AssistantMessageEvent>) {
				switch (event.type) {
					case 'text_delta':
						streamedText += event.delta;
						progress?.update(streamedText);
						break;
					case 'text_end':
						streamedText = event.content;
						progress?.update(streamedText);
						break;
					case 'done':
						finalMessage = event.message;
						break;
					case 'error':
						errorMessage = event.error;
						break;
				}
			}
		} catch (error) {
			const recovered = recoverStreamedSummary(summarizer, streamedText, error);
			if (recovered) return recovered;
			throw error;
		}

		if (errorMessage) {
			const recovered = recoverStreamedSummary(summarizer, streamedText, errorMessage.errorMessage);
			if (recovered) return recovered;
			return errorMessage;
		}
		if (finalMessage) return finalMessage;
		try {
			return await stream.result();
		} catch (error) {
			const recovered = recoverStreamedSummary(summarizer, streamedText, error);
			if (recovered) return recovered;
			throw error;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		progress?.fail(message);
		throw error;
	}
}

function recoverStreamedSummary(
	summarizer: ResolvedSummarizer,
	streamedText: string,
	error: unknown,
): AssistantMessage | undefined {
	const text = streamedText.trim();
	if (!text) return undefined;

	const message = error instanceof Error ? error.message : String(error ?? 'stream failed');
	return {
		role: 'assistant',
		content: [{ type: 'text', text }],
		api: summarizer.model.api,
		provider: summarizer.model.provider,
		model: summarizer.model.id,
		diagnostics: [
			{
				type: 'live-compaction-stream-recovered',
				timestamp: Date.now(),
				error: { message },
			},
		] as AssistantMessage['diagnostics'],
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
		stopReason: 'stop',
		timestamp: Date.now(),
	};
}

export function getTextFromAssistantResponse(response: AssistantMessage): string {
	return response.content
		.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
		.map((c) => c.text)
		.join('\n');
}

export function stripLeakedInternals(summary: string): string {
	return summary
		.split('\n')
		.filter((line) => {
			const trimmed = line.trimStart();
			return (
				!trimmed.startsWith('[Assistant thinking]:') &&
				!trimmed.startsWith('[Assistant tool calls]:') &&
				!trimmed.startsWith('[Tool result]:')
			);
		})
		.join('\n');
}
