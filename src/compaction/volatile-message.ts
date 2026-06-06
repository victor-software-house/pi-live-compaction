import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LIVE_COMPACTION_STREAM_CUSTOM_TYPE = 'live-compaction-stream';

const PATCH_FLAG = Symbol.for('pi-live-compaction.volatile-message-patch');

type CustomMessageInput = {
	customType: string;
	content: unknown;
	display: boolean;
	details?: unknown;
};

type AppCustomMessage = CustomMessageInput & {
	role: 'custom';
	timestamp: number;
};

type SendCustomMessage = (
	this: unknown,
	message: CustomMessageInput,
	options?: unknown,
) => Promise<void>;

type EmitCustomMessage = (event: {
	type: 'message_start' | 'message_end';
	message: AppCustomMessage;
}) => void;

type PatchableAgentSession = {
	sendCustomMessage?: SendCustomMessage;
	_emit?: EmitCustomMessage;
} & Record<symbol, unknown>;

type CodingAgentRuntime = {
	AgentSession?: { prototype?: PatchableAgentSession };
};

function createAppMessage(message: CustomMessageInput): AppCustomMessage {
	return {
		role: 'custom',
		customType: message.customType,
		content: message.content,
		display: message.display,
		details: message.details,
		timestamp: Date.now(),
	};
}

function resolveRuntimeCodingAgentIndex(): string {
	const entrypoint = process.argv[1];
	if (!entrypoint) {
		throw new Error('Cannot resolve Pi runtime: process.argv[1] is unavailable');
	}

	const resolvedEntrypoint = realpathSync(entrypoint);
	const indexPath = join(dirname(resolvedEntrypoint), 'index.js');
	if (!existsSync(indexPath)) {
		throw new Error(`Cannot resolve Pi runtime index from ${resolvedEntrypoint}`);
	}

	return indexPath;
}

async function importRuntimeCodingAgent(): Promise<CodingAgentRuntime> {
	return (await import(pathToFileURL(resolveRuntimeCodingAgentIndex()).href)) as CodingAgentRuntime;
}

export function installVolatileCompactionMessagePatchFromRuntime(
	runtime: CodingAgentRuntime,
): void {
	const prototype = runtime.AgentSession?.prototype;
	if (!prototype) {
		throw new Error('Runtime AgentSession prototype is unavailable');
	}
	if (prototype[PATCH_FLAG] === true) return;

	const original = prototype.sendCustomMessage;
	if (typeof original !== 'function') {
		throw new Error('Runtime AgentSession.sendCustomMessage is unavailable');
	}

	prototype.sendCustomMessage = async function sendVolatileCustomMessage(
		this: unknown,
		message: CustomMessageInput,
		options?: unknown,
	): Promise<void> {
		if (message.customType !== LIVE_COMPACTION_STREAM_CUSTOM_TYPE) {
			return original.call(this, message, options);
		}

		const session = this as PatchableAgentSession;
		if (typeof session._emit !== 'function') {
			return original.call(this, message, options);
		}

		const appMessage = createAppMessage(message);
		session._emit({ type: 'message_start', message: appMessage });
		session._emit({ type: 'message_end', message: appMessage });
	};
	prototype[PATCH_FLAG] = true;
}

export async function installVolatileCompactionMessagePatch(): Promise<void> {
	installVolatileCompactionMessagePatchFromRuntime(await importRuntimeCodingAgent());
}
