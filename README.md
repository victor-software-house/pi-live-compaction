# pi-live-compaction

Live streaming compaction for [Pi](https://github.com/earendil-works/pi-mono) — structured summaries with preset routing, Liquid templates, files-touched manifests, task-state continuity, and a full TUI settings panel.

## Why

Pi's built-in compaction produces a fixed 5-section summary using the session model. It works, but long sessions with complex multi-step work lose critical context: user intent trail, dead ends, task state, file manifests, and the operator's compaction focus.

**pi-live-compaction** replaces the built-in with a fully customizable compaction engine that streams summaries in real time, routes to dedicated summarizer models via presets, and preserves 11 structured sections of continuity state — including every user intent shift, every failed approach, and exact file paths the next agent should open first.

### Built-in vs pi-live-compaction

| | Pi Built-in | pi-live-compaction |
|---|---|---|
| **Summary model** | Session model only | Preset routing — any model, per-preset thinking level |
| **Prompt** | Hardcoded 5-section format | Liquid templates — fully customizable with layout inheritance and partials |
| **Streaming** | No streaming | Live streaming with partial recovery on stream failure |
| **Output sections** | 5 (Goal, Constraints, Progress, Decisions, Next Steps) | 11 (Brief, User intent trail, Constraints, Errors/dead ends, Key decisions, Status, Task continuity, Open issues, Next steps, Mandatory reading) |
| **User intent** | Not preserved | Full chronological trail with quote fidelity |
| **Task state** | Not included | `<task-state>` snapshot injected and reconciled |
| **Files touched** | Basic read/modified lists | Operation-badge manifest (R/W/E/M/D) with display paths |
| **Focus directive** | Not supported | `/compact <focus>` preserves exact operator goal |
| **Branch summary** | 5 fixed sections | 10 sections — verbatim user messages, reusable vs branch-local split, dead ends |
| **Settings** | None | Full TUI panel with scope switching, preset editor, prompt editor |
| **Config** | None | Global/project scope cascade with JSON config + prompt overrides |

## Install

```bash
pi install npm:pi-live-compaction
```

Or try without installing:

```bash
pi -e npm:pi-live-compaction
```

## How it works

The extension hooks into Pi's `session:beforeCompact` and `session:beforeTree` events. When compaction triggers:

1. **Resolves the summarizer** — picks a model from presets, inherits the session model, or falls back to a configured default
2. **Renders the prompt** — Liquid template engine composes the compaction request from partials (`_blocks.md`, `_contract.md`) with all context blocks
3. **Streams the summary** — calls the summarizer model with live streaming, showing progress in the TUI
4. **Recovers on failure** — if the stream breaks mid-summary, recovers whatever was streamed rather than crashing
5. **Logs diagnostics** — writes attempt entries with SHA-256 hashes, token counts, and transport info

### Template engine

Prompts are [LiquidJS](https://liquidjs.com/) templates powered by [pi-template-kit](https://github.com/victor-software-house/pi-template-kit). Templates support:

- **Layout inheritance** — `{% layout '_base' %}` + `{% block content %}`
- **Partials** — `{% include '_blocks' %}` from the sibling `templates/` directory
- **Frontmatter** — `preset:`, `thinking_level:`, `model:`, `description:` override runtime behavior per template
- **Custom filters** — `present`, `quote`, `tokens`, `text`, `last_user_text`
- **XML tags** — `{% xml "tag-name" %}...{% endxml %}` emits `<tag-name>...</tag-name>` or nothing when empty

### Context blocks

The template engine provides these variables:

| Variable | Content |
|---|---|
| `previous_summary` | Prior compaction summary (if any) |
| `discarded` | Serialized discarded conversation being replaced |
| `kept_tail` | Serialized kept-tail messages that remain raw after compaction |
| `task_state` | Live task-tracking snapshot at compaction time |
| `files_touched` | Files-touched manifest with operation badges |
| `focus` | Operator's `/compact <focus>` directive |
| `last_user_message` | Most recent user message text |

## Configuration

### Presets

Route compaction to different models with different thinking levels:

```json
{
  "defaultPreset": "deep",
  "presets": {
    "cheap": { "model": "anthropic/claude-haiku-4-5" },
    "default": { "model": "anthropic/claude-sonnet-4-20250514" },
    "deep": { "model": "anthropic/claude-sonnet-4-20250514", "thinkingLevel": "high" }
  }
}
```

Use `/compact --preset cheap` for lightweight compaction or let the default kick in automatically.

### Custom templates

Override the compaction prompt at global or project scope:

```
~/.pi/agent/extensions/live-compaction/compaction-prompt.md          # global
.pi/extensions/live-compaction/compaction-prompt.md                    # project
```

Templates are Liquid with frontmatter knobs:

```markdown
---
preset: deep
thinking_level: high
---
{% include '_blocks' %}
{%- if last_user_message | present %}
<latest-user-ask>
{{ last_user_message | truncate: 800 }}
</latest-user-ask>
{% endif %}
{% include '_contract' %}
```

### Settings panel

Run `/live-compaction` to open the interactive settings panel:

- Switch between global and project scope
- Edit default preset and manage preset collection
- Edit compaction and branch-summary prompts
- Toggle session-model inheritance
- Toggle files-touched manifests
- Verify runtime status

## Examples

The `examples/` directory contains 9 declarative golden-file examples covering the full feature set:

| # | Example | What it demonstrates |
|---|---|---|
| 01 | minimal | Smallest possible composition |
| 02 | full-blocks | Every block populated with `{% xml %}` auto-omit |
| 03 | helpers-tour | All shipped filters/tags + Liquid built-ins |
| 04 | tool-calls | Tool-call/tool-result loop with sibling partial |
| 05 | pipeline-shaping | Declarative data shaping — `where`/`slice`/`size`/`truncate` |
| 06 | layout-inheritance | `{% layout %}` + `{% block %}` inheritance |
| 07 | files-touched-many | Multi-file manifest with every operation badge combo |
| 08 | no-kept-tail | Empty kept-tail edge case |
| 09 | task-continuity | Task-state snapshot and continuity guidance |

Run `pnpm test` to verify all examples render to their golden expected output.

## Related packages

- [pi-template-kit](https://github.com/victor-software-house/pi-template-kit) — shared LiquidJS template engine, filters, and `{% xml %}` tag used by this package
- [pi-prompt-composer](https://github.com/victor-software-house/pi-prompt-composer) — build multi-option slash commands from plain prompts with variable expansion and interactive selectors

## Development

```bash
pnpm install
pnpm run typecheck     # tsc --noEmit
pnpm test              # vitest (50 tests)
pnpm run preview       # render a compaction prompt to stdout
pnpm run examples:update  # regenerate golden expected files
```

## Inspiration and attribution

This package was built from scratch as a Pi extension. The architecture was informed by:

- **pi-grounded-compaction** — the original local extension prototype that explored preset routing, template-driven prompts, and streaming compaction
- **Pi's official `custom-compaction.ts` example** — the reference for hooking into `session:beforeCompact` and returning custom compaction results

The compaction prompt contract, streaming engine, template system integration, TUI settings panel, files-touched manifest, task-state continuity, and branch-summary prompt are original work.

## License

MIT
