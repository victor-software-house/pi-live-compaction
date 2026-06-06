import { AgentSession } from '@earendil-works/pi-coding-agent';

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

export function installVolatileCompactionMessagePatch(): void {
	const prototype = AgentSession.prototype as unknown as PatchableAgentSession;
	if (prototype[PATCH_FLAG] === true) return;

	const original = prototype.sendCustomMessage;
	if (typeof original !== 'function') {
		throw new Error('AgentSession.sendCustomMessage is unavailable');
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
