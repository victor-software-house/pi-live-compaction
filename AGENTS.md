# pi-live-compaction

Live streaming compaction extension for Pi. Replaces Pi's built-in compaction with customizable Liquid templates, preset-routed summarizer models, and a full TUI settings panel.

## Repo layout

```
src/                     extension source (Pi entry: src/index.ts)
  index.ts               extension entry point
  types.ts               shared runtime types
  errors.ts              CompactionAbortedError
  attempt-entry.ts       diagnostic logger
  controller.ts          settings panel state machine
  session-fixtures.ts    test/preview fixture builder
  config/                config schema, file I/O, prompt contracts
  preset/                preset matching + summarizer resolution
  template/              Liquid template loading + render-var builders
    templates/           shipped Liquid partials (_blocks.md, _contract.md)
  summary/               LLM completion wiring (SYSTEM_PROMPT, streaming)
  compaction/            runLiveCompaction handler + orchestrator + progress
  branch/                runGroundedBranchSummaryAugmentation
  command/               /live-compaction TUI settings panel
  files-touched/         file-touch manifest extraction
test/                    vitest suite (50 tests)
  fixtures/              test fixtures
  snapshots/             golden snapshots (tracked)
examples/                prompt/config examples (9 declarative + .example files)
  templates/             Liquid partials for the .example templates
bin/                     preview and example-update scripts
```

## Key modules

| Path | Responsibility |
|---|---|
| `src/index.ts` | Extension entry — thin wiring of hooks + command |
| `src/compaction/handler.ts` | `runLiveCompaction` main handler |
| `src/compaction/orchestrator.ts` | `summarizeWithResolvedModel`, `executeSummaryCall` |
| `src/summary/stream.ts` | Streaming LLM call with partial recovery on stream failure |
| `src/template/loader.ts` | Liquid template loading via `pi-template-kit` |
| `src/config/` | Scope-aware config, preset management, prompt resolution cascade |
| `src/controller.ts` | State management, validation, settings panel data |
| `src/command/` | `/live-compaction` TUI settings panel |
| `src/attempt-entry.ts` | Diagnostic entry logger |
| `src/files-touched/` | File-touch manifest extraction from session history |
| `src/session-fixtures.ts` | Session message construction helpers |

See `src/AGENTS.md` for full domain map.

Rules: each module exports pure/factory functions, no circular imports back
to `index.ts`, `RunDeps` injection stays for testability, extract one at a
time with typecheck + test after each.

## Dependencies

- **Peer**: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` (Pi SDK — consumer already has these)
- **Runtime**: `pi-template-kit` (public npm, Liquid engine), `dedent`
- **No private deps** — publishable to public npm

## Development

```bash
pnpm install
pnpm run typecheck
pnpm test
```

Extensionless imports with `@live-compaction/*` and `@test/*` tsconfig path aliases. No build step — Pi loads TS directly via jiti.

## Config paths

- Global: `~/.pi/agent/extensions/live-compaction/`
- Project: `.pi/extensions/live-compaction/`
- Resolution: project → global → hardcoded defaults
- TUI panel (`/live-compaction`) supports scope switching

## Conventions

- Conventional Commits enforced via commitlint
- Changesets for versioning (`pnpm changeset`)
- Public npm (`access: "public"`)
- Pi 0.78.0+ peer deps
- Strip-only TS compatible (no parameter properties, enums, or namespaces)
- No `../` imports — enforced by biome `noRestrictedImports` + oxlint `import-alias`
- No inline imports (`import("pkg")`) — top-level only
- Tabs, single quotes, 100-col (biome)

## Pi extension API rules

Only use documented public APIs from Pi's `extensions.md` and `tui.md`.
Never access private internals (`_emit`, `chatContainer`, `rebuildChatFromMessages`,
`statusContainer`, `agent.state.messages`).

### Message rendering

- `registerMessageRenderer(type, fn)` — **function form only**. Object form
  `{ render: fn }` silently falls back to the default renderer.
- Every `sendMessage({ display: true })` MUST have a matching
  `pi.on('context', ...)` filter unless the content is intended for the LLM.
  `custom_message` entries are converted to user messages by `convertToLlm()`.
- Use `customType` as the stable key for lookup — one live message per type.

### TUI rendering

- `TUI.requestRender()` is required after any component mutation.
  `invalidate()` alone does nothing visible.
- TUI ref: capture from any factory-based API (`setWidget`, `setFooter`,
  `custom()`). Session-lifetime singleton, never stale.
- Dual mutation for live streaming: `msgObj.content` (rebuild-safe) +
  `txtRef.setText()` (immediate visual) + `TUI.requestRender()`.
- Never hardcode theme RGB values — use `theme.bg(key)` / `theme.fg(key)`.

### Theme colors for compaction phases

| Phase | Background key |
|---|---|
| Streaming | `toolPendingBg` (same as in-progress tool calls) |
| Done | `customMessageBg` (same as Pi's native compaction summary) |
| Error | `toolErrorBg` |

### Session entry safety

- `getEntries()` / `getEntry(id)` return live mutable objects (same ref,
  confirmed via `===`). Safe to mutate properties.
- Only mutate `display` (rendering hint). Never insert or remove entries
  from the session tree — breaks the parent/child chain.
- Use `findLast` (ES2023) for last-to-first entry lookup — native, no copy.
- `session_compact` fires before `rebuildChatFromMessages` — the tightest
  point to hide transient messages before Pi's built-in takes over.

### What extensions cannot do

- Inject into `chatContainer` or trigger `rebuildChatFromMessages()`
- Replace `CompactionSummaryMessageComponent` rendering (hardcoded)
- Use `custom()` during compaction (blocks agent loop)
- Access `statusContainer`, `pendingMessagesContainer`, or `Loader` internals

Full technical reference: `docs/tui-streaming-patterns.md`.

## Testing

- `pnpm test` runs the full vitest suite (50 tests)
- Extract one module at a time — typecheck + full test suite after each
- Golden snapshots tracked in `test/snapshots/`
- No real provider APIs, keys, or paid tokens in tests
