# Restructure: Domain Subdirectories + Flat Source Root

## Context

`extensions/live-compaction/` is redundant nesting — Pi auto-discovers
`extensions/*/index.ts` but we use explicit `pi.extensions` in package.json
anyway. Examples (`.md.example`, `config.json.example`) are mixed with source.
Several files exceed 400 LOC. No progressive disclosure via nested AGENTS.md.

**Goals:**
- Remove redundant `extensions/` wrapper
- Keep files under 400 LOC
- Domain subdirs with `index.ts` barrel exports
- Nested AGENTS.md + CLAUDE.md shims for progressive disclosure
- Examples moved to `examples/` (already exists for prompt templates)

## Proposed structures

### Option A: `src/` with domain subdirs (pi-ssh-tools pattern)

```
src/
├── index.ts                 — extension entry point + re-exports
├── AGENTS.md                — source architecture overview
├── CLAUDE.md                — shim → AGENTS.md
│
├── compaction/              — main compaction flow
│   ├── index.ts             — re-exports handler + orchestrator
│   ├── AGENTS.md            — compaction domain guide
│   ├── CLAUDE.md
│   ├── handler.ts           — runLiveCompaction (~250)
│   ├── orchestrator.ts      — summarizeWithResolvedModel, executeSummaryCall (~250)
│   ├── progress.ts          — makeSummaryProgress, notify, boundTaskStateBlock (~100)
│   └── result.ts            — buildSuccessResult, collectKeptTailMessages (~80)
│
├── branch/                  — branch summary augmentation
│   ├── index.ts             — re-exports handler
│   ├── handler.ts           — runGroundedBranchSummaryAugmentation (~140)
│   └── AGENTS.md
│
├── config/                  — config schema, file I/O, paths
│   ├── index.ts             — re-exports
│   ├── AGENTS.md
│   ├── CLAUDE.md
│   ├── schema.ts            — types, defaults, constants (~200)
│   ├── io.ts                — load/save, path resolution (~300)
│   └── prompts.ts           — prompt contract loading, template bodies (~300)
│
├── preset/                  — preset matching + summarizer resolution
│   ├── index.ts             — re-exports
│   ├── matching.ts          — parseCompactInstructions, resolvePresetMatch (~75)
│   ├── summarizer.ts        — resolve*Summarizer, fallback chains (~160)
│   └── AGENTS.md
│
├── command/                 — TUI panel + /live-compaction command
│   ├── index.ts             — re-exports registerLiveCompactionCommand
│   ├── AGENTS.md
│   ├── panel.ts             — panel items, settings UI (~300)
│   ├── handlers.ts          — subcommand handlers (~300)
│   └── completions.ts       — autocomplete logic (~200)
│
├── files-touched/           — file tracking + manifest rendering
│   ├── index.ts             — re-exports
│   ├── AGENTS.md
│   ├── collector.ts         — collectFilesTouched main (~200)
│   ├── parsers.ts           — bash/tool/cli parsing (~350)
│   ├── paths.ts             — normalization, root mapping (~350)
│   ├── manifest.ts          — renderFilesTouchedManifestBlock (~55)
│   └── types.ts             — FilesTouchedEntry, ops (~30)
│
├── summary/                 — summary stream + completion wiring
│   ├── index.ts             — re-exports
│   ├── stream.ts            — completeWithResolvedSummarizer, SSE (~210)
│   └── constants.ts         — SYSTEM_PROMPT, options builders (~50)
│
├── template/                — liquid template loading + render vars
│   ├── index.ts             — re-exports
│   ├── loader.ts            — loadCompactionTemplate, built-in singletons (~200)
│   ├── render-vars.ts       — buildRenderVars, buildBranchSummaryRenderVars (~130)
│   └── types.ts             — frontmatter, CompactionTemplate (~70)
│
├── types.ts                 — HookContext, RunDeps, SummaryProgress (~95)
├── errors.ts                — CompactionAbortedError (~10)
├── attempt-entry.ts         — compaction attempt logging (~56)
└── controller.ts            — compaction controller state machine (~310)

examples/                    — prompt template examples (unchanged)
├── 01-minimal/
├── ...
├── config.json.example      ← moved from src/
├── compaction-prompt.md.example  ← moved from src/
└── branch-summary-prompt.md.example  ← moved from src/
```

### Option B: `src/` with fewer, coarser subdirs

```
src/
├── index.ts
├── AGENTS.md
├── CLAUDE.md
├── types.ts
├── errors.ts
├── attempt-entry.ts
├── controller.ts
│
├── core/                    — compaction + branch + preset + summarizer
│   ├── index.ts
│   ├── AGENTS.md
│   ├── compaction-handler.ts  (~400, keep as-is if under limit)
│   ├── branch-handler.ts     (~140)
│   ├── preset.ts             (~75)
│   ├── summarizer.ts         (~160)
│   ├── progress.ts           (~100)
│   └── result.ts             (~80)
│
├── config/                  — same as Option A
│   └── ...
│
├── command/                 — same as Option A
│   └── ...
│
├── files-touched/           — same as Option A
│   └── ...
│
├── summary/                 — same as Option A
│   └── ...
│
└── template/                — same as Option A
    └── ...
```

### Option C: `src/` with minimal nesting (only split what's big)

```
src/
├── index.ts
├── AGENTS.md
├── CLAUDE.md
├── types.ts
├── errors.ts
├── attempt-entry.ts
├── controller.ts
├── preset.ts
├── summarizer.ts
├── branch-handler.ts
│
├── compaction/              — only the biggest domain gets a subdir
│   ├── index.ts
│   ├── handler.ts
│   ├── orchestrator.ts
│   ├── progress.ts
│   └── result.ts
│
├── config/                  — 804 LOC needs splitting
│   ├── index.ts
│   ├── schema.ts
│   ├── io.ts
│   └── prompts.ts
│
├── command/                 — 825 LOC needs splitting
│   ├── index.ts
│   ├── panel.ts
│   ├── handlers.ts
│   └── completions.ts
│
├── files-touched/           — 1176 LOC needs splitting
│   ├── index.ts
│   ├── collector.ts
│   ├── parsers.ts
│   ├── paths.ts
│   ├── manifest.ts
│   └── types.ts
│
├── summary/
│   └── ...
│
└── template/
    └── ...
```

## Comparison

| Aspect | A (full domain) | B (coarse) | C (minimal) |
|---|---|---|---|
| Subdirs | 8 | 5 | 5 |
| Max file LOC | ~350 | ~400 | ~350 |
| AGENTS.md files | 8 nested | 5 nested | 3 nested |
| Granularity | Fine — each domain isolated | Medium — core bundles related | Mixed — small modules stay flat |
| Progressive disclosure | Best | Good | OK |
| Cognitive overhead | Higher nav depth | Balanced | Easiest initial nav |
| Matches pi-ssh-tools | Closest | Somewhat | Somewhat |

## Shared changes (all options)

- **`extensions/live-compaction/` → `src/`**: Update `pi.extensions`, tsconfig paths, all tool configs
- **Examples moved**: `.example` files → `examples/`
- **Nested AGENTS.md**: Each subdir gets one documenting its domain
- **CLAUDE.md shims**: One-line `See @AGENTS.md` in each subdir
- **tsconfig paths**: `@live-compaction/*` → `src/*` (glob still works)
- **package.json `files`**: `["src", "examples", "bin", "README.md", ...]`

## Recommendation

**Option A** — most consistent with pi-ssh-tools, best progressive disclosure,
cleanest domain boundaries. The extra subdirs are justified by file count and
domain independence (files-touched knows nothing about compaction, config knows
nothing about TUI, etc).

## Verification

After restructure:
- [ ] `pnpm run typecheck` — zero errors
- [ ] `pnpm run test` — 50/50 pass
- [ ] `pnpm run lint` — zero errors (warnings OK in tests)
- [ ] `oxlint` — zero errors
- [ ] All test imports still resolve
- [ ] `pi.extensions` path updated and tested
