---
title: "Compaction Structural Awareness and Tail Boundary UX"
prd: PRD-001
status: Draft
owner: "Victor"
issue: "N/A"
date: 2026-05-09
version: "1.0"
---

# PRD: Compaction Structural Awareness and Tail Boundary UX

---

## 1. Problem & Context

Pi compaction currently creates a summary entry that replaces older session history while preserving a recent raw-message tail. Current runtime evidence shows two related problems:

- `@earendil-works/pi-coding-agent/dist/core/session-manager.js` builds model context by emitting the latest compaction summary first, then kept messages from `firstKeptEntryId`, then messages after the compaction entry.
- `@earendil-works/pi-coding-agent/dist/core/messages.js` converts the compaction summary into a user-role text block with `The conversation history before this point was compacted...`, but it does not mark where the preserved tail starts or ends.
- `@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js` rebuilds chat from `buildSessionContext()` after compaction and also appends a compaction summary message for the just-finished run. On reload, the canonical context order still shows the summary before the preserved tail.
- `packages/live-compaction/extensions/live-compaction/index.ts` already sends `<discarded-conversation>`, `<kept-tail>`, `<previous-summary>`, `<files-touched>`, and `<focus>` to the summary model, but structural instructions are baked into one `SYSTEM_PROMPT` string and prompt contracts rather than being configurable per template.
- `packages/live-compaction/extensions/live-compaction/templates/_contract.md.example` tells the model the summary will appear before `<kept-tail>` and that `<kept-tail>` remains live, but template authors can omit or weaken this structural awareness.

The result is confusing for both users and models:

1. The next agent sees a compaction summary without explicit boundary markers around the preserved tail.
2. The summary may receive less attention than raw tail messages because it is a synthetic user message before recent conversation.
3. Users must scroll up to find the compaction summary when the tail is long.
4. Forking from inside the kept tail is semantically risky unless the fork preserves prior compaction state plus the selected tail prefix, rather than creating a new summary of `A..B-1`.
5. `/compact <focus>` instructions may not be preserved exactly or emphasized enough unless every template author gets the contract right.

This PRD defines expected behavior before implementation. It covers Pi core behavior and the local `pi-live-compaction` extension because the feature crosses both boundaries.

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| **Explicit model structure** | LLM payload contains clear markers for compaction summary, tail start, and tail end | 100% of compacted session contexts include boundaries unless disabled by explicit config |
| **Correct summary placement** | Compaction summary appears after the compaction checkpoint in user-facing timeline | Default UI places the compaction component at the compaction event location, after the preserved tail for newly compacted sessions |
| **Safe fork semantics** | Fork from inside a preserved tail keeps prior compacted context and selected raw prefix | Fork from `B-1` includes existing prior compaction or original root plus `A..B-1`; it does not generate a new synthetic compaction |
| **Template-independent awareness** | Structural guidance applies even when a template omits `_contract` | Default structural-awareness system addendum applies for all compaction templates |
| **Exact focus preservation** | Summary model receives `/compact` focus text exactly as provided | Prompt includes verbatim focus content in a protected block and system guidance requires exact consideration |

**Guardrails (must not regress):**
- Existing `firstKeptEntryId` append-only session format remains readable.
- Existing live-compaction templates continue to render without changes.
- Summary output must not copy the full kept tail into the summary.
- User intent from both discarded span and kept tail remains considered during compression.
- Branch-summary behavior stays unchanged unless explicitly touched by a later PRD.

---

## 3. Users & Use Cases

### Primary: Pi operator

> As a Pi operator, I want compaction summaries and preserved tails to have obvious boundaries so that I can understand what context is compressed and what remains raw.

**Preconditions:** A session has been manually or automatically compacted.

### Primary: Continuation agent

> As a continuation agent, I want the model payload to say where the compaction summary sits relative to the preserved tail so that I do not confuse summarized history with live recent context.

**Preconditions:** The agent receives a compacted session context.

### Secondary: Template author

> As a compaction template author, I want structural-awareness defaults to be enforced outside my template so that I can customize prompt shape without accidentally removing boundary guidance.

**Preconditions:** A project or global `compaction-prompt.md` override exists.

### Secondary: Forking user

> As a user forking inside the preserved tail, I want the fork to preserve the previous compacted state and the selected prefix of the raw tail so that history remains meaningful without a new lossy compaction.

**Preconditions:** The selected fork point is inside the preserved tail of a compacted session.

---

## 4. Scope

### In scope

1. **Compacted-context boundary markers** — add explicit model-facing markers for compaction summary, tail start, and tail end.
2. **Compaction summary placement semantics** — define and implement default behavior where the user-facing compaction component appears at the compaction event point after the preserved tail for current-session display, while the model payload remains structurally unambiguous.
3. **Fork semantics from preserved tail** — ensure forked sessions from within the tail keep prior compaction state and selected raw tail prefix without generating a new summary.
4. **Structural-awareness prompt layer** — add a template-independent system prompt addendum controlled by frontmatter.
5. **Frontmatter schema** — support `structural-awareness: true | false | string` with default `true`.
6. **Exact focus handling** — guarantee `/compact` focus content is passed verbatim and called out in structural guidance.
7. **Tests and docs** — cover payload ordering, markers, frontmatter parsing, template rendering, and fork behavior.

### Out of scope / later

| What | Why | Tracked in |
|------|-----|------------|
| Changing branch-summary prompts | Branch summaries do not use kept-tail semantics | Later PRD if needed |
| Rewriting compaction storage from append-only JSONL | High blast radius; current format can support boundaries with metadata/messages | N/A |
| Summarizing the kept tail into the compaction output | Kept tail remains raw in context; full duplication wastes tokens and risks drift | N/A |
| Model-specific prompt tuning beyond structural awareness | Current need is structural, not vendor-specific | N/A |

### Design for future (build with awareness)

The design should allow future boundary components and payload annotations without requiring a session format migration. Prefer explicit metadata on existing entries plus deterministic context construction over one-off hidden prompt text.

---

## 5. Functional Requirements

### FR-1: Model payload marks compaction summary and preserved tail boundaries

When Pi builds LLM context for a compacted session, the payload must make these spans explicit:

- compaction summary start/end
- preserved tail start/end
- messages after compaction start/end or equivalent ordering marker

**Acceptance criteria:**

```gherkin
Given a session compacted at checkpoint B with firstKeptEntryId A
When Pi builds the LLM context after compaction
Then the context contains a compaction summary marker
And the context contains a preserved tail start marker before entry A
And the context contains a preserved tail end marker after the last preserved pre-compaction entry
And the markers are visible to the model as instructionally neutral context
```

**Files:**
- `@earendil-works/pi-coding-agent/dist/core/session-manager.js` / upstream source — adjust `buildSessionContext()` behavior.
- `@earendil-works/pi-coding-agent/dist/core/messages.js` / upstream source — adjust compaction summary text or add boundary message constructors.

### FR-2: User-facing timeline shows the compaction event at the compaction checkpoint by default

The TUI must make it visually clear that compaction happened after the preserved tail, not before it.

**Acceptance criteria:**

```gherkin
Given a user manually runs /compact in a session with preserved tail A..B
When compaction finishes
Then the chat view shows A..B in normal chronological order
And the compaction component appears after B as the compaction checkpoint
And the component label explains what older context was summarized and what tail remains raw
```

**Files:**
- `@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js` / upstream source — update rebuild/render placement logic.
- `@earendil-works/pi-coding-agent/dist/modes/interactive/components/compaction-summary-message.js` / upstream source — update label and description.

### FR-3: Legacy summary-before-tail model ordering remains configurable

Pi must offer an override to keep stock behavior where the compaction summary appears before the preserved tail in model context and/or UI if needed for compatibility.

**Acceptance criteria:**

```gherkin
Given compaction placement config is set to legacy summary-before-tail
When Pi rebuilds a compacted session
Then model context preserves the old summary-before-tail order
And structural markers still identify where summary, tail start, and tail end sit
```

**Files:**
- Upstream Pi settings schema — add placement config.
- `docs/settings.md` in upstream Pi docs — document override.

### FR-4: Fork inside preserved tail keeps prior compaction plus selected tail prefix

Forking from inside `A..B` must not create a new compaction summary for `A..B-1`. The fork should carry previous compacted history or original root plus raw messages through the selected fork point.

**Acceptance criteria:**

```gherkin
Given a compacted session with previous compaction C and preserved tail entries A, B-1, B
When the user forks before B
Then the forked session contains C
And it contains raw entries A through B-1
And it does not contain a newly generated summary for A through B-1
```

**Files:**
- `@earendil-works/pi-coding-agent/dist/core/session-manager.js` / upstream source — verify or adjust `createBranchedSession()` for compacted paths.
- `@earendil-works/pi-coding-agent/dist/core/agent-session-runtime.js` / upstream source — verify `/fork` and `/clone` target behavior.

### FR-5: Structural-awareness invariants are non-overridable

Grounded compaction must inject structural-awareness instructions independently from the user template body. These invariants are not controlled by template frontmatter because custom templates must not be able to accidentally remove carry-forward safety.

**Acceptance criteria:**

```gherkin
Given a custom compaction-prompt.md that omits kept-tail guidance
When live-compaction executes a summary call
Then the system prompt still explains previous summary, discarded conversation, kept tail, files touched, focus, and output placement
And the template body remains unchanged
```

**Files:**
- `extensions/live-compaction/summary-stream.ts` — keep non-overridable carry-forward invariants in `SYSTEM_PROMPT`.
- `test/summary-stream.test.ts` — assert the invariant names each transient block with backticked XML-style tags.
- `test/prompt-surfaces.test.ts` — assert a custom minimal template still receives the invariant through `context.systemPrompt` while the template body stays custom.

### FR-6: Summary output must never point at transient prompt blocks

The summary model sees `<previous-summary>`, `<discarded-conversation>`, `<kept-tail>`, `<files-touched>`, and `<focus>` while generating the checkpoint. The continuation model does not see those blocks as separate data sources. The generated summary must carry forward needed facts in normal prose instead of referencing block names.

**Acceptance criteria:**

```gherkin
Given previous summary and focus data are present during compaction
When live-compaction generates a summary
Then the system prompt forbids placeholders such as see previous summary, per `<focus>`, as above, and earlier trail omitted
And the resulting summary carries needed previous-summary and focus facts forward in self-contained prose
```

**Files:**
- `extensions/live-compaction/summary-stream.ts` — forbid transient-block handoffs and placeholder references.
- `test/summary-stream.test.ts` — cover non-overridable wording.
- Live validation script/output — inspect compacted session JSONL for leaked `<previous-summary>` / `<focus>` references after reload.

### FR-7: Focus content is included verbatim and carried forward when relevant

The focus string from `/compact <focus>` must be included exactly as provided in the rendered prompt and called out in system guidance as high-priority compaction guidance. If focus affects continuation, the summary must restate the goal itself, not say `per <focus>`.

**Acceptance criteria:**

```gherkin
Given the user runs /compact preserve exact TODO list: A > B
When live-compaction renders the summary request
Then the focus block contains preserve exact TODO list: A > B byte-for-byte
And the system prompt says focus is user-provided compaction guidance that must be considered
And the summary carries forward focus-driven next steps without referencing `<focus>`
```

**Files:**
- `extensions/live-compaction/index.ts` — preserve focus in render vars.
- `extensions/live-compaction/templates/_blocks.md` and `.example` — render the focus block.
- `bin/preview-compaction-prompt.ts` — expose exact focus preview.
- `test/prompt-surfaces.test.ts` — render live custom and packaged templates with focus.

### FR-8: Summary output must consider kept-tail user intent without duplicating the full tail

The compaction summary must summarize discarded history, previous summary, focus, and the user intent trail across the kept tail. User messages from the discarded span require higher fidelity than kept-tail messages because the discarded span is replaced by the summary while kept-tail remains raw. The summary must not restate the whole kept tail.

**Acceptance criteria:**

```gherkin
Given kept-tail contains recent user messages that change the objective
When the summary is generated
Then the summary reflects the changed objective and immediate next step
And it preserves materially important discarded user messages with higher fidelity than kept-tail messages
And it does not include a full copy of every kept-tail assistant and tool message
```

**Files:**
- `extensions/live-compaction/config.ts` — update default contract.
- `extensions/live-compaction/templates/_contract.md.example` — update example contract.
- `test/snapshots/template.snapshot.test.ts.snap` — update snapshots.


### FR-9: Attempt logs include full request prompts

Every compaction attempt must log the exact request payload needed to audit summary quality after the fact. The `request_rendered` attempt entry must include the full summarizer system prompt, full rendered compaction prompt, character counts, and SHA-256 hashes for both strings.

**Acceptance criteria:**

```gherkin
Given live-compaction renders a compaction request
When it appends the request_rendered attempt entry
Then the entry contains the complete system prompt string
And it contains the complete rendered compaction prompt string
And it contains char counts and SHA-256 hashes for both prompts
```

**Files:**
- `extensions/live-compaction/attempt-entry.ts` — add prompt payload, char-count, and hash fields to attempt schema.
- `extensions/live-compaction/index.ts` — append full `SYSTEM_PROMPT` and rendered prompt text on `request_rendered`.
- `test/auth.compat.test.ts` — assert request logs include full prompts and hashes.

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Backward compatibility** | Existing session JSONL files must load without migration. Missing marker metadata must degrade to old behavior plus best-effort markers. |
| **Token budget** | Boundary markers and structural-awareness addendum must stay below 500 tokens by default. |
| **Template compatibility** | Existing Liquid templates must not break unless they use invalid frontmatter values. |
| **Safety** | Serialized history, focus, and tail content must be described as data, not instructions to execute. |
| **Observability** | Preview/test tools must show effective structural-awareness text and rendered focus blocks. Compaction attempt logs must include full rendered system and compaction prompts plus hashes. |

---

## 7. Risks & Assumptions

### Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Changing model context order alters agent behavior | High | Medium | Keep legacy placement override and add tests comparing old/new payloads |
| UI and model payload need different ordering | Medium | High | Separate display placement from model payload markers; do not force one representation to serve both |
| Fork behavior already depends on append-only path assumptions | High | Medium | Add fixture tests before changing code; preserve existing IDs where possible |
| Structural-awareness string in frontmatter can become prompt injection vector | Medium | Low | Treat it as trusted template author config, not user/session content; document scope |
| Extra markers increase token usage | Low | High | Keep marker text short and deterministic |
| Full prompt logging increases session JSONL size | Medium | High | Log only on request_rendered attempt entries; include hashes so audits can compare payloads without repeated rendering |

### Assumptions

- The upstream Pi source corresponding to installed `dist/` can be patched or vendored as part of follow-up implementation.
- Existing `firstKeptEntryId` is enough to locate preserved tail boundaries.
- For current behavior, `createBranchedSession()` copies the path to the selected leaf; tests must confirm whether that path includes the prior compaction when forking inside the preserved tail.
- Structural-awareness belongs in the system prompt because it governs how to interpret prompt blocks, not in the user template body.

---

## 8. Design Decisions

### D1: Structural awareness lives in the system prompt and is not template-overridable

**Options considered:**
1. Add guidance to every template — simple but easy for custom templates to omit.
2. Add guidance to the system prompt — template-independent and harder to accidentally weaken.
3. Add guidance to the system prompt but allow template frontmatter to disable or replace it — flexible, but a custom template can silently remove the exact safety invariant this work is meant to enforce.
4. Add hidden custom message — closer to model payload but visible in session context and harder to scope.

**Decision:** Keep carry-forward invariants in `SYSTEM_PROMPT` without a template-frontmatter opt-out.

**Rationale:** Structural awareness is about interpreting the entire summary task, not about output schema. It must apply even when a user writes a minimal custom Liquid template. Template contracts can describe sections and style; they must not own safety rules such as "do not reference `<previous-summary>` or `<focus>` in the final summary."

**Future path:** If policy customization becomes necessary, use a trusted package/global config with explicit warnings, not per-template frontmatter.

### D2: Summary output references kept tail but does not duplicate it

**Options considered:**
1. Require summary to copy the full kept tail — maximally explicit but wasteful and drift-prone.
2. Require summary to ignore kept tail — saves tokens but loses current intent.
3. Require summary to consider kept tail for objective/status/next steps without exhaustive duplication.

**Decision:** Use option 3.

**Rationale:** Kept tail remains raw in context; summary should use it to align state, not duplicate it.

### D3: Forking inside tail preserves existing compaction state

**Options considered:**
1. Generate a new compaction for selected tail prefix — lossy and semantically surprising.
2. Drop prior compaction and keep only tail prefix — loses older context.
3. Preserve prior compaction plus selected tail prefix — matches user mental model.

**Decision:** Preserve prior compaction plus selected prefix.

**Rationale:** Forking selects a timeline prefix. It should not invent a new compression event.

### D4: Boundary markers should be model-visible, not only UI-visible

**Options considered:**
1. UI-only marker component — helps users, not model.
2. Model-only text markers — helps model, not users.
3. Both model-visible markers and user-facing component labels.

**Decision:** Use both.

**Rationale:** The reported problem affects both operator navigation and model interpretation.

---

## 9. File Breakdown

| File | Change type | FR | Description |
|------|-------------|-----|-------------|
| `extensions/live-compaction/summary-stream.ts` | Modify | FR-5, FR-6, FR-7, FR-8 | Keep non-overridable structural-awareness, transient-block carry-forward rules, and discarded-user-message fidelity rule in `SYSTEM_PROMPT`. |
| `extensions/live-compaction/config.ts` | Modify | FR-8 | Keep default output contract focused on schema and style, not non-overridable carry-forward invariants. |
| `extensions/live-compaction/index.ts` | Modify | FR-7, FR-9 | Preserve focus in render vars, pass `SYSTEM_PROMPT` to the summarizer, and log full rendered request prompts. |
| `extensions/live-compaction/templates/_contract.md` and `.example` | Modify | FR-8 | Keep reusable output schema partial aligned with packaged example. |
| `extensions/live-compaction/templates/_blocks.md` and `.example` | Modify | FR-7 | Render previous-summary, discarded, kept-tail, files-touched, and focus blocks for local and packaged templates. |
| `bin/preview-compaction-prompt.ts` | Existing / verify | FR-7 | Preview exact focus rendering. |
| `test/summary-stream.test.ts` | Modify | FR-5, FR-6, FR-7 | Assert non-overridable system prompt names transient blocks with backticked XML-style tags and forbids placeholder handoffs. |
| `test/auth.compat.test.ts` | Modify | FR-9 | Assert `request_rendered` attempt entries include full system prompt, full compaction prompt, char counts, and hashes. |
| `test/prompt-surfaces.test.ts` | Add | FR-5, FR-7 | Render live custom and packaged templates, and prove a minimal custom template still receives system-scope invariants. |
| `test/template.*.test.ts` | Modify | FR-7, FR-8 | Assert rendered templates exclude system-only invariants and do not leak `undefined`. |
| `test/snapshots/template.snapshot.test.ts.snap` | Modify | FR-8 | Update expected prompt snapshots. |
| Upstream `packages/coding-agent/src/core/session-manager.ts` | Modify | FR-1, FR-3, FR-4 | Add boundary-aware context construction and fork tests. |
| Upstream `packages/coding-agent/src/core/messages.ts` | Modify | FR-1 | Add or update marker message conversion. |
| Upstream `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | Modify | FR-2 | Render compaction checkpoint in chronological visual position. |
| Upstream `packages/coding-agent/src/modes/interactive/components/compaction-summary-message.ts` | Modify | FR-2 | Update compaction component label/description. |
| Upstream `docs/compaction.md` | Modify | FR-1, FR-2, FR-3, FR-4 | Document new semantics and override. |

---

## 10. Dependencies & Constraints

- Requires access to upstream Pi source, not only installed `dist/` files.
- Grounded-compaction package depends on `@earendil-works/pi-coding-agent` APIs; any new core marker helpers must be exported before the extension can use them directly.
- Session files are append-only JSONL trees. Implementation should not rewrite historical entries except in explicit tests/fixtures.
- Frontmatter parsing currently uses `gray-matter`; schema changes must stay YAML-compatible.

---

## 11. Rollout Plan

1. Add tests that capture current behavior for `buildSessionContext()`, TUI compaction placement, and fork inside preserved tail.
2. Implement upstream Pi boundary markers and placement config behind defaults.
3. Update live-compaction `SYSTEM_PROMPT`, template partials, examples, and tests; keep carry-forward invariants outside overridable templates.
4. Update snapshots and preview expectations.
5. Run focused upstream Pi tests plus `pnpm run check` and `pnpm test` in `packages/live-compaction`.
6. Verify manually in a live Pi session: compact, inspect TUI placement, inspect model payload if probe tools are available, fork inside tail, resume fork.
7. Update `docs/compaction.md` and relevant local Pi memory only after behavior is verified.

---

## 12. Open Questions

| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| Q1 | Should model payload order change to tail-then-summary, or only add explicit markers while preserving summary-before-tail for LLM compatibility? | Victor | 2026-05-10 | Open |
| Q2 | Should `structural-awareness: false` be allowed in project templates, or only in trusted global templates? | Victor | 2026-05-10 | Answered: no per-template opt-out for carry-forward invariants; future trusted global config can revisit. |
| Q3 | Should placement override live in core Pi settings, live-compaction config, or both? | Victor | 2026-05-10 | Open |
| Q4 | Does current `createBranchedSession()` already preserve compaction entries when forking inside the tail? | Implementer | 2026-05-10 | Open |
| Q5 | Should tail boundary markers be represented as custom messages, compaction summary text, or a new internal message role? | Implementer | 2026-05-10 | Open |

---

## 13. Related

| Issue | Relationship |
|-------|-------------|
| N/A | Original PRD from operator feedback in Pi session |
| `docs/compaction.md` upstream | Current documented compaction behavior and session payload ordering |
| `packages/live-compaction` | Local extension that controls summary prompt generation |

---

## 14. Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-05-10 | Clarified discarded user messages require higher-fidelity preservation than kept-tail because discarded messages are replaced by the summary | Victor |
| 2026-05-10 | Added full prompt logging requirement and aligned prompt-quality guidance with current implementation | Victor |
| 2026-05-10 | Updated to reflect non-overridable `SYSTEM_PROMPT` placement for transient-block carry-forward invariants and current prompt-surface tests | Victor |
| 2026-05-09 | Initial draft | Victor |

---

## 15. Verification (Appendix)

Post-implementation checklist:

1. Create a fixture session with prior compaction, kept tail `A..B`, and post-compaction message `C`.
2. Assert model context contains explicit compaction summary, tail start, tail end, and post-compaction boundaries.
3. Assert TUI render order places the compaction checkpoint after `B` by default.
4. Toggle legacy placement and assert old order remains available with markers.
5. Fork before `B` and assert fork contains prior compaction plus `A..B-1`, with no newly generated summary.
6. Render a custom template with no `_contract` and assert default structural-awareness system addendum is present.
7. Render a custom template with `structural-awareness: false` and assert the addendum is absent.
8. Render a custom minimal template and assert the carry-forward invariant is present in `context.systemPrompt` while absent from the rendered template body.
9. Run `/compact focus text with symbols <A> & B` and assert focus appears byte-for-byte in the rendered prompt preview.
10. After Pi reload, inspect the active session JSONL and assert the latest active compaction summary does not contain placeholder references to `<previous-summary>` or `<focus>`.
11. Inspect the `live-compaction.attempt` `request_rendered` entry and verify full `systemPrompt`, full `renderedPrompt`, char counts, and hashes are present.

## 16. Live Validation Notes

### 2026-05-10: Prompt logging and summary-quality recompact

Validated session:

`/Users/victor/.pi/agent/sessions/--Users-victor--/2026-05-09T17-19-09-138Z_019e0dc0-0752-7102-93b2-ce622bb42c39.jsonl`

Latest compaction inspected: `e504408c` (`2026-05-11T01:39:21.552Z`), attempt `7a23b282-c3b9-4ad2-b927-52e97fc6adda`.

Observed results:

- `live-compaction.attempt` `request_rendered` logged full `systemPrompt` and full `renderedPrompt`.
- `systemPromptChars` was `2501`; `renderedPromptChars` was `623094` by JavaScript string length.
- `systemPromptSha256` and `renderedPromptSha256` were present and hash-verified against the logged strings.
- Summary used exact `## User intent trail` heading with no parenthetical qualifier.
- Summary did not contain placeholder references to `<previous-summary>`, "see previous summary", or `per <focus>`.
- User intent trail improved: it preserved the iTerm2 notification/tooling arc, chezmoi shell-integration decisions, badge API findings, state persistence requirements, and current `promptGuidelines` ask in chronological order.
- A literal placeholder ``Pi · <focus>`` appeared under title-format constraints. This is not a compaction `<focus>` block reference, but future audit scripts should avoid treating arbitrary angle-bracket examples as block leaks; prompt examples should prefer `Pi · topic` when possible.

Remaining verification from this PRD still concerns upstream Pi core behavior: model-visible tail boundary markers, TUI placement, and fork semantics.
