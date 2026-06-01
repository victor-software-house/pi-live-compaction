# pi-live-compaction

<p align="center">
  <img src="https://raw.githubusercontent.com/victor-software-house/pi-live-compaction/main/assets/thumbs/final/pi-live-compaction-og.png" alt="pi-live-compaction" width="720" />
</p>

Live streaming compaction for [Pi](https://github.com/earendil-works/pi-mono) — structured summaries with preset routing, Liquid templates, files-touched manifests, task-state continuity, and a full TUI settings panel.

## Highlights

- **11 continuity sections** instead of 5 — intent trail, dead ends, task state, file manifests, mandatory reading
- **Live streaming** — watch the summary form as it compacts; partial recovery if the stream breaks
- **Preset routing** — route compaction to any model with per-preset thinking levels and fallback chains
- **Liquid templates** — fully customizable prompts with layout inheritance, partials, frontmatter knobs
- **Focus directive** — `/compact <focus>` preserves the exact operator goal through compaction
- **TUI settings panel** — scope switching, preset editor, prompt editor, runtime status

## Install

```bash
pi install npm:pi-live-compaction
```

Or try without installing:

```bash
pi -e npm:pi-live-compaction
```

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/victor-software-house/pi-live-compaction/main/assets/readme/final/pipeline.png" alt="Compaction pipeline" width="720" />
</p>

The extension hooks into Pi's `session:beforeCompact` and `session:beforeTree` events:

1. **Resolves the summarizer** — picks a model from presets, inherits the session model, or falls back to a configured default
2. **Renders the prompt** — Liquid template engine composes the request from partials with all context blocks
3. **Streams the summary** — calls the summarizer with live streaming, showing progress in the chat flow
4. **Recovers on failure** — if the stream breaks mid-summary, recovers whatever was streamed
5. **Logs diagnostics** — writes attempt entries with SHA-256 hashes, token counts, and transport info

### What the summary preserves

<p align="center">
  <img src="https://raw.githubusercontent.com/victor-software-house/pi-live-compaction/main/assets/readme/final/sections.png" alt="11 continuity sections" width="540" />
</p>

Every compaction summary captures what happened, where things stand, and what to do next — so the next agent (or the same session after compaction) opens the right files and doesn't repeat failed approaches.

### Preset routing

<p align="center">
  <img src="https://raw.githubusercontent.com/victor-software-house/pi-live-compaction/main/assets/readme/final/presets.png" alt="Preset routing" width="540" />
</p>

Route compaction to different models with different thinking levels. Use `/compact --preset deep` for thorough compaction or let the default kick in automatically. If the selected preset's model auth fails, the fallback chain tries cheaper models before falling back to the session model.

```json
{
  "defaultPreset": "default",
  "fallbackPreset": "cheap",
  "presets": {
    "fast": { "model": "openai-codex/gpt-5.4-mini", "thinkingLevel": "medium" },
    "cheap": { "model": "anthropic/claude-haiku-4-5", "thinkingLevel": "low" },
    "default": { "model": "anthropic/claude-sonnet-4-6", "thinkingLevel": "medium" },
    "deep": { "model": "anthropic/claude-sonnet-4-6", "thinkingLevel": "high" },
    "thorough": { "model": "anthropic/claude-opus-4-8", "thinkingLevel": "xhigh" }
  }
}
```

### Template engine

Prompts are [LiquidJS](https://liquidjs.com/) templates powered by [pi-template-kit](https://github.com/victor-software-house/pi-template-kit):

- **Layout inheritance** — `{% layout '_base' %}` + `{% block content %}`
- **Partials** — `{% include '_blocks' %}` from the sibling `templates/` directory
- **Frontmatter** — `preset:`, `thinking_level:`, `model:`, `description:` override runtime behavior per template
- **Custom filters** — `present`, `quote`, `tokens`, `text`, `last_user_text`
- **XML tags** — `{% xml "tag-name" %}...{% endxml %}` emits `<tag-name>...</tag-name>` or nothing when empty

### Context blocks

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

All configuration lives in `config.json` files. Prompts are Liquid templates (`.md`). Both support a two-level scope cascade:

| Scope | Path |
|---|---|
| Project | `.pi/extensions/live-compaction/` |
| Global | `~/.pi/agent/extensions/live-compaction/` |

Resolution order: **project → global → built-in defaults**. Project overrides win. The TUI panel (`/live-compaction`) lets you switch between scopes when editing.

Each scope directory can contain:

```
config.json                  # preset routing, feature toggles
compaction-prompt.md         # main compaction template (Liquid)
branch-summary-prompt.md     # branch summary template (Liquid)
```

### Custom templates

Drop a `compaction-prompt.md` or `branch-summary-prompt.md` in the project or global scope directory. Templates are [LiquidJS](https://liquidjs.com/) with frontmatter knobs:

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

Run `pnpm test` to verify all examples render to their golden expected output. See [`examples/AGENTS.md`](examples/AGENTS.md) for full details.

<details>
<summary><strong>Built-in vs pi-live-compaction</strong> — full comparison</summary>

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

</details>

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

## Roadmap

- **Per-preset fallback chains** — each preset declares its own fallback model, enabling retry chains before falling back to the session model
- **Per-preset prompt routing** — map preset tiers to prompt template variants so stronger models get richer contracts
- **Context-aware model selection** — auto-select presets based on session length, available models, cost budget, and provider health
- **Reusable TUI components** — adopt shared `SettingsPanel` / editor components for the settings panel

## Inspiration

The architecture was informed by [pi-grounded-compaction](https://github.com/marcfargas/pi-grounded-compaction) — an early prototype that explored preset routing, template-driven prompts, and streaming compaction — and Pi's official [`custom-compaction.ts` example](https://github.com/earendil-works/pi-mono/blob/main/examples/extensions/custom-compaction.ts) for hooking into `session:beforeCompact`.

The compaction prompt contract, streaming engine, template system integration, TUI settings panel, files-touched manifest, task-state continuity, and branch-summary prompt are original work.

## License

MIT
