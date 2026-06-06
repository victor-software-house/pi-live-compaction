import { AgentSession } from '@earendil-works/pi-coding-agent';
import {
	installVolatileCompactionMessagePatch,
	LIVE_COMPACTION_STREAM_CUSTOM_TYPE,
} from '@live-compaction/compaction/volatile-message';
import { afterEach, describe, expect, it, vi } from 'vitest';

const PATCH_FLAG = Symbol.for('pi-live-compaction.volatile-message-patch');

type CustomMessageInput = {
	customType: string;
	content: unknown;
	display: boolean;
	details?: unknown;
};

type SendCustomMessage = (
	this: unknown,
	message: CustomMessageInput,
	options?: unknown,
) => Promise<void>;

type PatchablePrototype = {
	sendCustomMessage?: SendCustomMessage;
} & Record<symbol, unknown>;

const prototype = AgentSession.prototype as unknown as PatchablePrototype;
const nativeSendCustomMessage = prototype.sendCustomMessage;
const nativePatchFlag = prototype[PATCH_FLAG];

afterEach(() => {
	prototype.sendCustomMessage = nativeSendCustomMessage;
	if (nativePatchFlag === undefined) {
		delete prototype[PATCH_FLAG];
	} else {
		prototype[PATCH_FLAG] = nativePatchFlag;
	}
});

describe('installVolatileCompactionMessagePatch', () => {
	it('emits live compaction stream messages without calling native persistence path', async () => {
		const nativeCalls: unknown[] = [];
		prototype.sendCustomMessage = vi.fn(async function nativeSend(message: unknown) {
			nativeCalls.push(message);
		});
		delete prototype[PATCH_FLAG];

		installVolatileCompactionMessagePatch();

		const emit = vi.fn();
		const session = Object.create(prototype) as {
			sendCustomMessage: SendCustomMessage;
			_emit: typeof emit;
		};
		session._emit = emit;

		await session.sendCustomMessage({
			customType: LIVE_COMPACTION_STREAM_CUSTOM_TYPE,
			content: '_Waiting for model output…_',
			display: true,
		});

		expect(nativeCalls).toEqual([]);
		expect(emit).toHaveBeenCalledTimes(2);
		expect(emit).toHaveBeenNthCalledWith(1, {
			type: 'message_start',
			message: expect.objectContaining({
				role: 'custom',
				customType: LIVE_COMPACTION_STREAM_CUSTOM_TYPE,
				content: '_Waiting for model output…_',
				display: true,
			}),
		});
		expect(emit).toHaveBeenNthCalledWith(2, {
			type: 'message_end',
			message: expect.objectContaining({
				role: 'custom',
				customType: LIVE_COMPACTION_STREAM_CUSTOM_TYPE,
			}),
		});
	});

	it('delegates unrelated custom messages to the native send path', async () => {
		const nativeSend = vi.fn(async () => undefined);
		prototype.sendCustomMessage = nativeSend;
		delete prototype[PATCH_FLAG];

		installVolatileCompactionMessagePatch();

		const session = Object.create(prototype) as {
			sendCustomMessage: SendCustomMessage;
		};
		const message = {
			customType: 'other-extension',
			content: 'hello',
			display: true,
		};
		const options = { triggerTurn: false };

		await session.sendCustomMessage(message, options);

		expect(nativeSend).toHaveBeenCalledTimes(1);
		expect(nativeSend).toHaveBeenCalledWith(message, options);
	});
});
