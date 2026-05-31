# pi-live-compaction

Live streaming compaction extension for Pi. Replaces Pi's built-in compaction with customizable Liquid templates, preset-routed summarizer models, and a full TUI settings panel.

## Repo layout

```
extensions/
  live-compaction/       extension source (Pi entry: index.ts)
    templates/           Liquid partials (_blocks.md, _contract.md)
    *.ts                 core modules
    *.md.example         default prompt/config examples
test/                    vitest suite (50 tests)
  fixtures/              test fixtures
  snapshots/             golden snapshots (tracked)
examples/                9 declarative golden-file template examples
bin/                     preview and example-update scripts
```

## Key modules

| File | Responsibility |
|---|---|
| `index.ts` | Extension entry — hooks `session:beforeCompact` + `session:beforeTree`, preset resolution, summary orchestration |
| `compaction-chat-message.ts` | Live-streaming custom message in chat flow (renderer, context filter, cleanup) |
| `summary-stream.ts` | Streaming LLM call with partial recovery on stream failure |
| `template.ts` | Liquid template loading via `pi-template-kit` with frontmatter parsing |
| `config.ts` | Scope-aware config (global/project), preset management, prompt resolution cascade |
| `controller.ts` | State management, validation, settings panel data |
| `command.ts` | `/live-compaction` TUI settings panel |
| `attempt-entry.ts` | Diagnostic entry logger |
| `files-touched.ts` | File-touch manifest extraction from session history |
| `files-touched-manifest.ts` | Manifest rendering for compaction/branch summaries |
| `session-fixtures.ts` | Session message construction helpers |

## Module structure (planned extraction from `index.ts`)

`index.ts` is 1174 lines bundling too many concerns. Extraction targets:

| Section | Target | Status |
|---|---|---|
| Instruction parsing + preset matching | `preset.ts` | planned |
| Model / summarizer resolution | `summarizer.ts` | planned |
| `makeSummaryProgress` | `compaction-chat-message.ts` | done |
| Summarization core + compaction handler | `compaction-handler.ts` | planned |
| Branch summary handler | `branch-handler.ts` | planned |
| Extension factory | stays in `index.ts` (thin wiring) | — |

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
- Tabs, single quotes, 100-col (biome)
