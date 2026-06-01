# ADR 001: Chat-Flow Streaming for Live Compaction Display

**Status:** Accepted
**Date:** 2026-05-31

## Context

Pi extensions need to show live-streaming compaction output to the user.
Three approaches were evaluated:

1. **Widget slot** (`setWidget` above/below editor) — detached from chat flow,
   visually separate from the conversation.
2. **`custom()` blocking overlay** — blocks the agent loop until `done()`;
   cannot be used during compaction (deadlock).
3. **Chat-flow custom message** — `sendMessage` + `registerMessageRenderer`
   renders inline in the chat, same as native Pi messages.

## Decision

Use the **7-step chat-flow custom message pattern** with only documented
public Pi APIs:

1. Capture TUI ref from widget factory (`setWidget`)
2. Register message renderer (function form — object form silently breaks)
3. Filter from LLM context via `pi.on('context')`
4. Hide on compaction via `pi.on('session_compact')`
5. Send message via `pi.sendMessage({ customType, display: true })`
6. Dual mutation (`msgObj.content` + `txtRef.setText()` + `TUI.requestRender()`)
7. Cleanup: `session_compact` sets `entry.display = undefined`

## Consequences

- Live output appears inline in the chat — natural reading flow.
- Zero upstream Pi changes required.
- Must filter custom messages from LLM context (they become user messages otherwise).
- `registerMessageRenderer` must use function form, not `{ render: fn }`.
- Dual mutation is required for immediate + rebuild-safe updates.
- Full technical reference: `docs/tui-streaming-patterns.md`.
