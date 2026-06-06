import {
	installVolatileCompactionMessagePatchFromRuntime,
	LIVE_COMPACTION_STREAM_CUSTOM_TYPE,
} from '@live-compaction/compaction/volatile-message';
import { describe, expect, it, vi } from 'vitest';

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

function makeRuntime(nativeSend: SendCustomMessage): {
	prototype: PatchablePrototype;
	runtime: { AgentSession: { prototype: PatchablePrototype } };
} {
	const prototype: PatchablePrototype = {
		sendCustomMessage: nativeSend,
	};
	return { prototype, runtime: { AgentSession: { prototype } } };
}

describe('installVolatileCompactionMessagePatchFromRuntime', () => {
	it('emits live compaction stream messages without calling native persistence path', async () => {
		const nativeCalls: unknown[] = [];
		const { prototype, runtime } = makeRuntime(async function nativeSend(message: unknown) {
			nativeCalls.push(message);
		});

		installVolatileCompactionMessagePatchFromRuntime(runtime);

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
		expect(prototype[PATCH_FLAG]).toBe(true);
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
		const { prototype, runtime } = makeRuntime(nativeSend);

		installVolatileCompactionMessagePatchFromRuntime(runtime);

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
