# TUI Streaming Patterns

Internal reference for live-rendering compaction summaries in Pi's chat flow.
Covers what works, what doesn't, and why.

## Architecture

Pi's interactive mode layout (top to bottom):

```
headerContainer
chatContainer          ← messages live here
pendingMessagesContainer
statusContainer        ← Loader/spinner
widgetContainerAbove   ← extension widgets (aboveEditor)
editorContainer        ← user input
widgetContainerBelow   ← extension widgets (belowEditor)
footer
```

Extensions cannot inject into `chatContainer` directly. The only way to place
content in the chat flow is via `pi.sendMessage()` + `pi.registerMessageRenderer()`.

## Proven Pattern: Custom Message in Chat Flow

### 1. Capture TUI ref

All factory-based UI APIs pass the TUI instance: `setWidget`, `setFooter`,
and `custom()` all receive `(tui, theme, ...)`. This is documented in
Pi's `tui.md` (Pattern 6: Custom Footer shows `tui.requestRender()` directly).

The message renderer API does NOT receive `tui` — only `(message, options, theme)`.
To use `tui.requestRender()` from a message renderer context, capture the ref
from any factory-based API:

```typescript
let TUI: TUI | undefined;
ctx.ui.setWidget('_cap', (tui) => { TUI = tui; return new Spacer(0); }, { placement: 'belowEditor' });
setTimeout(() => ctx.ui.setWidget('_cap', undefined), 100);
```

The TUI ref is a session-lifetime singleton. Never stale. Safe to keep.
The `setFooter` factory is an equally valid capture source.

### 2. Register message renderer

**Must be a function, not an object with a `render` method.**

```typescript
// CORRECT
pi.registerMessageRenderer(customType, (message, options, theme) => { ... });

// WRONG — silently falls back to default purple renderer
pi.registerMessageRenderer(customType, { render(message) { ... } });
```

The renderer is called:
- Once when `sendMessage` fires (initial render)
- On every `rebuild()` triggered by `setExpanded()` (ctrl+o)
- With `options.expanded` for collapse/expand state

### 3. Send message

```typescript
pi.sendMessage({ customType, content: '...', display: true });
```

**Warning: `custom_message` entries participate in LLM context.** The content
is converted to a user message by `buildSessionContext()` → `convertToLlm()`.
You MUST filter it out (see step 4).

### 4. Filter from LLM context

```typescript
pi.on('context', (event) => ({
  messages: event.messages.filter(m =>
    !(m.role === 'custom' && m.customType === customType)
  ),
}));
```

This is the native Pi API. No external dependencies needed.

### 5. Live streaming updates

Dual mutation required:

```typescript
function update(text: string) {
  // 1. Mutate message object — survives rebuild (ctrl+o)
  msgObj.content = text;

  // 2. Mutate component — immediate visual update
  txtRef?.setText(theme.fg('muted', text));
  headerRef?.setText(headerText);

  // 3. Flush render — without this, nothing updates
  TUI.requestRender();
}
```

**Why dual mutation?**
- `msgObj.content` alone: no visual update until next `rebuild()`
- `txtRef.setText()` alone: reverts on ctrl+o (rebuild reads `message.content`)
- Both together: immediate + rebuild-safe

### 6. Event-driven streaming

Use `pi.events` pub/sub instead of setTimeout:

```typescript
// Producer (compaction handler)
pi.events.emit('live-compaction:chunk', { text: accumulated });
pi.events.emit('live-compaction:done', { text: final });

// Consumer (renderer setup)
pi.events.on('live-compaction:chunk', ({ text }) => update(text));
pi.events.on('live-compaction:done', ({ text }) => finish(text));
```

### 7. Cleanup via `session_compact`

`session_compact` fires AFTER compaction is committed but BEFORE
`compaction_end` triggers `rebuildChatFromMessages()`. Look up by `customType`
directly — no ID tracking needed (only one live message per compaction):

```typescript
pi.on('session_compact', (_event, ctx) => {
  const entries = ctx.sessionManager.getEntries();
  const entry = [...entries].reverse()
    .find(e => e.type === 'custom_message' && e.customType === CUSTOM_TYPE);
  if (entry) entry.display = undefined;
});
```

On the next line, `compaction_end` fires → `rebuildChatFromMessages()` → our
message is skipped (display is falsy) → Pi's built-in
`CompactionSummaryMessageComponent` takes over.

The `finish()` function only handles visual state (bg color transition +
final content). Entry cleanup belongs to the compaction lifecycle hook.

**Safety:** `getEntries()` returns live mutable objects (not clones — confirmed
via `===` identity check). We only mutate `display` (a rendering hint), never
insert or remove entries. Pi's own examples (`snake.ts`, `preset.ts`) rely on
the same mutable-entry pattern for session state (see `extensions.md` §
pi.appendEntry).

## Theme Colors

| Color key | Use |
|---|---|
| `toolPendingBg` | During streaming (same as in-progress tool calls) |
| `customMessageBg` | Completed / done (same as Pi's native compaction summary) |
| `toolErrorBg` | Failed |

These are `theme.bg()` keys. Actual colors depend on the active theme.
Use `theme.bg('toolPendingBg', text)` — never hardcode RGB values.

## Anti-patterns

### ✘ `invalidate()` without `requestRender()`

`invalidate()` marks a component dirty but does NOT trigger a screen repaint.
Always call `TUI.requestRender()` after mutations.

### ✘ Mutating only `msgObj.content`

Content mutation alone is invisible until the next `rebuild()`. Must also
call `setText()` on the Text component for immediate visual update.

### ✘ Mutating only `txtRef.setText()`

Visual update only. Reverts on ctrl+o because `rebuild()` re-creates
components from `message.content`. Must also mutate `msgObj.content`.

### ✘ `sendMessage` without context filter

Every `custom_message` becomes a user message in LLM context. Always
register a `pi.on('context', ...)` filter for transient display messages.

### ✘ `registerMessageRenderer` with object form

```typescript
// BROKEN — falls back to default renderer silently
pi.registerMessageRenderer(type, { render(msg) { ... } });
```

Must be a bare function: `(message, options, theme) => Component`.

### ✘ `custom()` for streaming

`ctx.ui.custom(factory, opts)` blocks the agent loop until `done()` is
called. Cannot be used during compaction — would deadlock.

### ✘ `CustomEntry` (type: "custom") for display

`appendCustomEntry` creates entries that are completely invisible — no chat
rendering, no LLM context. Only useful for persisted extension state.

### ✘ `setHeader` for compaction display

Replaces the entire header. Destructive and visually jarring.

## What extensions cannot do

- Inject components into `chatContainer` directly
- Call `rebuildChatFromMessages()` (private to InteractiveMode)
- Replace the `Loader` component or its color functions
- Change `CompactionSummaryMessageComponent` rendering (hardcoded)
- Access `statusContainer` or `pendingMessagesContainer`

## Related

- Demo script: `/tmp/stream-chat-demo.js`
- Session artifact: `demo/stream-chat-demo.md`
- Pi source: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- TUI source: `packages/tui/src/tui.ts`
