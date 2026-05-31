# pi-live-compaction

Live streaming compaction extension for Pi. Replaces Pi's built-in compaction with customizable Liquid templates, preset-routed summarizer models, and a full TUI settings panel.

## Repo layout

```
extensions/
  live-compaction/       extension source (Pi entry: index.ts)
    templates/           Liquid partials (_blocks.md, _contract.md)
    *.ts                 core modules
    *.md.example         default prompt/config examples
  _shared/               shared utils (files-touched)
test/                    vitest suite (50 tests)
  fixtures/              test fixtures
  snapshots/             golden snapshots (tracked)
examples/                9 declarative golden-file template examples
docs/prd/                design docs (Draft)
bin/                     preview and example-update scripts
```

## Key modules

| File | Responsibility |
|---|---|
| `index.ts` | Extension entry — hooks `session:beforeCompact` + `session:beforeTree`, preset resolution, summary orchestration |
| `summary-stream.ts` | Streaming LLM call with partial recovery on stream failure |
| `template.ts` | Liquid template loading via `pi-template-kit` with frontmatter parsing |
| `config.ts` | Scope-aware config (global/project), preset management, prompt resolution cascade |
| `controller.ts` | State management, validation, settings panel data |
| `command.ts` | `/live-compaction` TUI settings panel |
| `attempt-entry.ts` | Diagnostic entry logger |
| `_shared/files-touched-core.ts` | File-touch manifest extraction from session history |

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

All imports use `.ts` extensions (Pi loads TS directly via jiti). No build step.

## Config paths

- Global: `~/.pi/agent/extensions/live-compaction/`
- Project: `.pi/extensions/live-compaction/`
- Project overrides global for config, compaction prompt, and branch-summary prompt

## Conventions

- Conventional Commits enforced via commitlint
- Changesets for versioning (`pnpm changeset`)
- Public npm (`access: "public"`)
- Pi 0.78.0+ peer deps
- Strip-only TS compatible (no parameter properties, enums, or namespaces)
