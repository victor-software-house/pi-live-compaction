# src/ — Source architecture

Extension entry point: `src/index.ts`. Path alias: `@live-compaction/*` → `src/*`.

## Domain layout

| Directory / File | Responsibility |
|---|---|
| `index.ts` | Extension entry — registers hooks + command, thin wiring only |
| `types.ts` | Shared runtime types: `HookContext`, `RunDeps`, `SummaryProgress` |
| `errors.ts` | `CompactionAbortedError`, `isAbortError` |
| `attempt-entry.ts` | Diagnostic attempt logger |
| `controller.ts` | State machine + `LiveCompactionController` interface |
| `session-fixtures.ts` | Test/preview fixture builder (no Pi dep) |
| `config/` | Config schema, file I/O, path resolution, prompt contracts |
| `preset/` | Preset matching (`parseCompactInstructions`, `resolvePresetMatch`) + summarizer resolution |
| `template/` | Liquid template loading, render-var builders, built-in template singletons |
| `summary/` | LLM call wiring (`completeWithResolvedSummarizer`, `SYSTEM_PROMPT`, options builders) |
| `compaction/` | `runLiveCompaction` handler + orchestrator + progress UI |
| `branch/` | `runGroundedBranchSummaryAugmentation` (session_before_tree hook) |
| `command/` | `/live-compaction` TUI settings panel |
| `files-touched/` | File-touch manifest extraction from session history |

## Conventions

- No `../` imports — use `@live-compaction/xxx` path aliases throughout.
- Intra-domain sibling imports use `@live-compaction/<domain>/<file>` (enforced by oxlint import-alias).
- All source is strip-mode TS compatible (no parameter properties, enums, or namespaces).
- Barrel `index.ts` in each subdir re-exports the domain's public surface.
- Every file ≤ 400 LOC.
