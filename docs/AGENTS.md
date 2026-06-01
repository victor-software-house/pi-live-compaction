# docs/

Internal engineering documentation for pi-live-compaction.

## Contents

| Document | Scope |
|---|---|
| [tui-streaming-patterns.md](tui-streaming-patterns.md) | How to render live-streaming content in Pi's chat flow. Covers the custom message pattern, Pi API surface, theme colors, anti-patterns, and extension capability boundaries. Read before touching any TUI rendering code. |
| [adr/](adr/) | Architectural Decision Records — chat-flow streaming, domain structure, theme colors, strip-only TS, jsPlugins. |

## Where other knowledge lives

- **Repo layout, conventions, dev workflow** → root `AGENTS.md`
- **Module structure, extraction plan** → root `AGENTS.md` § Module structure
- **Compaction lifecycle, handler wiring** → inline comments in source modules
- **Template system, Liquid partials** → `examples/AGENTS.md` + `examples/README.md`
- **Config schema, preset resolution** → `config.ts` + `controller.ts` headers
