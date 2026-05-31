# live-compaction examples

Each subdirectory is a declarative example:

```
NN-name/
  case.json                input data (messages, files-touched, focus, …)
  compaction-prompt.md     Liquid template with optional frontmatter knobs
  templates/               optional sibling partials and layouts
  expected.md              golden output, byte-for-byte
```

Auto-discovered by [`test/examples.test.ts`](../test/examples.test.ts) and
asserted on every `pnpm test` run via the runner in
[`test/example-runner.ts`](../test/example-runner.ts).

## Engine

We ship **LiquidJS only**. Earlier iterations supported handlebars and eta;
those landed in commit history but were dropped because Liquid is the most
fluent choice for this domain — pipe filters (`{{ x | truncate: 800 }}`),
declarative data shaping (`where: "role", "user"`), real
`{% layout %}` + `{% block %}` inheritance, and a sandboxed runtime.

The frontmatter `engine:` knob is gone. Frontmatter only carries runtime
knobs: `preset`, `thinking_level`, `model`, `description`.

## Adding a new example

1. Create `examples/NN-short-name/` with a [`case.json`](./01-minimal/case.json) and a `compaction-prompt.md`.
2. Run `pnpm examples:update [NN-short-name]` to materialize `expected.md`.
3. Eyeball `expected.md`. Commit when it is what you want.
4. Future renders are pinned to that golden file. Re-run `pnpm examples:update` after intentional template/helper changes.

## case.json schema

| Field | Type | Notes |
|--|--|--|
| `description` | string | Required. Surfaced as the test name. |
| `previous_summary` | string | Optional. Populates `<previous-summary>`. |
| `focus` | string | Optional. Populates `<focus>` (e.g. `/compact …` body). |
| `files_touched` | array | Optional. Each entry is `{ ops: "RWEMD", displayPath, path? }`. |
| `include_files_touched` | boolean | Optional. Defaults to true when `files_touched` is non-empty. Set false to assert the empty-block path. |
| `discarded` | array | Required. Discarded span. Each item is either `{ role, text }` or `{ role, content: [...] }`. |
| `kept_tail` | array | Required. Kept-tail span (raw context that survives compaction). |

`content` blocks support `text`, `toolCall`, and `toolResult` shapes — see
[`04-tool-calls`](./04-tool-calls/case.json) for the canonical
tool-call/tool-result loop.

## Custom helpers (provided by `pi-template-kit` on top of stock Liquid)

**Filters:**

| Filter | Use |
|--|--|
| `text` | extract text content from a Pi `Message` |
| `last_user_text` | newest user message text across one or more `Message[]` arrays |
| `tokens` | rough chars/4 estimate |
| `quote` | `"escaped"` for inline display |
| `present` | true for non-empty strings/arrays (and any other truthy value) |

**Tags:**

| Tag | Use |
|--|--|
| `{% xml "name" %}…{% endxml %}` | wraps the body in `<name>…</name>`. Emits nothing when the body renders empty. |

Everything else uses Liquid built-ins: `truncate`, `truncatewords`, `where`,
`map`, `slice`, `size`, `concat`, `first`, `last`, `==`/`!=`, `{% if %}`,
`{% for %}`, `{% include %}`, `{% layout %}` + `{% block %}`, etc.

## Catalogue

| # | Example | What it shows |
|--|--|--|
| 01 | [01-minimal](./01-minimal) | Smallest possible composition |
| 02 | [02-full-blocks](./02-full-blocks) | Every block populated using the `{% xml %}` block tag (auto-omits empty bodies) |
| 03 | [03-helpers-tour](./03-helpers-tour) | Reference for `text`, `last_user_text`, `tokens`, `quote`, `present`, `{% xml %}`, plus key Liquid built-ins |
| 04 | [04-tool-calls](./04-tool-calls) | Tool-call/tool-result loop + sibling partial via `{% include %}` |
| 05 | [05-pipeline-shaping](./05-pipeline-shaping) | Declarative data shaping with `where`/`slice`/`size`/`concat`/`truncate` — no imperative `{% for %}`/`{% if %}` ceremony |
| 06 | [06-layout-inheritance](./06-layout-inheritance) | Real layout inheritance: `_base.md` owns the scaffolding, the prompt overrides only `{% block content %}` |
| 07 | [07-files-touched-many](./07-files-touched-many) | Multi-file files-touched manifest (regression coverage for the `undefined`-rows bug) |
| 08 | [08-no-kept-tail](./08-no-kept-tail) | Empty kept-tail edge case |
