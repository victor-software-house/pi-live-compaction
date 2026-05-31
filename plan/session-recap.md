# Pi Live Compaction — Session Recap & Next Steps

## What shipped this session

### 1. TUI Streaming Pattern Research ✅

Proved the **7-step chat-flow custom message pattern** using only documented
public Pi APIs — zero upstream changes needed. 10+ `probe_eval` demos
confirmed every step:

```
┌─────────────────────────────────────────────────────┐
│  Pi Chat Flow                                       │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ [user] /compact --preset fast                 │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ [compaction · streaming]  42 lines            │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  ## Brief                                     │  │
│  │  Working on pi-live-compaction...             │  │
│  │  ▌ (streaming)                                │  │
│  │                         toolPendingBg         │  │
│  └───────────────────────────────────────────────┘  │
│                    ↓ finish()                       │
│  ┌───────────────────────────────────────────────┐  │
│  │ [compaction · done]  127 lines                │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  ## Brief                                     │  │
│  │  Working on pi-live-compaction at...          │  │
│  │                         customMessageBg       │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ session_compact fires → entry.display = undef │  │
│  │ → Pi's native CompactionSummary takes over    │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Key APIs used:** `sendMessage`, `registerMessageRenderer` (fn form only),
`pi.on('context')`, `pi.on('session_compact')`, `setWidget` (TUI capture),
`TUI.requestRender()`, dual mutation (`msgObj.content` + `txtRef.setText()`).

### 2. Tooling Alignment ✅

```
mise.toml          → Node 24, pnpm 11.2.2
lefthook.yml       → pre-commit (format + lint + typecheck)
                     commit-msg (commitlint)
.oxlintrc.json     → plugins: ["typescript"], type-aware rules
                     jsPlugins for import-alias (NOT built-in)
biome.json         → test overrides: noExplicitAny + noNonNullAssertion → warn
tsconfig.json      → lib: ["ES2023"] for findLast
```

### 3. Full Restructure (Option A) ✅

Moved from `extensions/live-compaction/` flat layout → `src/` with 8 domain subdirs:

```
BEFORE                              AFTER
extensions/live-compaction/         src/
├── index.ts (1176 LOC!)            ├── index.ts (72 LOC)
├── config.ts (804 LOC)             ├── compaction/
├── command.ts (825 LOC)            │   ├── handler.ts (267)
├── files-touched.ts (1176 LOC)     │   ├── orchestrator.ts (235)
├── compaction-handler.ts (661)     │   ├── progress.ts (111)
├── summary-stream.ts (208)         │   ├── result.ts (57)
├── template.ts (336)               │   └── chat-message.ts (185) ← NEW
├── branch-handler.ts (126)         ├── branch/handler.ts (126)
├── preset.ts (75)                  ├── config/{schema,io,prompts}
├── summarizer.ts (153)             ├── preset/{matching,summarizer}
├── controller.ts (310)             ├── command/{panel,handlers,completions}
├── *.example (mixed w/ source)     ├── files-touched/{collector,parsers,paths,tokenizer}
└── runtime-types.ts                ├── summary/{stream,constants}
                                    ├── template/{loader,render-vars,types}
                                    ├── types.ts, errors.ts, controller.ts
                                    └── */AGENTS.md + CLAUDE.md (×9 subdirs)

Max file: 395 LOC (command/panel.ts)
.example files → examples/
```

### 4. Chat-Flow Streaming Implementation ✅

`src/compaction/chat-message.ts` — the actual streaming progress:

```
registerCompactionChatMessage(pi)
  │
  ├── Registers renderer (fn form)
  │     └── Shared ChatState closure
  ├── Registers context filter
  ├── Registers session_compact cleanup
  │
  └── Returns makeChatSummaryProgress factory
        │
        ├── .start() → capture TUI ref, sendMessage
        ├── .update() → dual mutation + requestRender
        ├── .finish() → phase=done, requestRender
        └── .fail() → error widget

Wired via deps.makeProgress in RunDeps
Falls back to existing widget-based progress when not provided
```

## Verification

| Gate | Result |
|------|--------|
| `pnpm run typecheck` | ✅ 0 errors |
| `pnpm run test` | ✅ 50/50 pass |
| `biome check` | ✅ 0 errors (13 warnings in tests — pre-existing) |
| `oxlint` | ✅ 0 errors |
| Max file LOC | ✅ 395 (command/panel.ts) |

## Commits

| SHA | Type | Description |
|-----|------|-------------|
| `d56b6f1` | chore | mise + lefthook + oxlint + biome + tsconfig |
| `5d6166c` | refactor | modularize index.ts (1176 → 72 LOC) |
| `31bfd1a` | refactor | restructure to src/ with domain subdirs |
| `928376d` | feat | chat-flow streaming progress for compaction |

## Next steps

### Execution order

| Order | # | Task | Effort | Description |
|-------|---|------|--------|-------------|
| 1 | 22 | Fix linting-stack skill | Small | `import-alias` documented as built-in oxlint plugin — it's actually `@limegrass/eslint-plugin-import-alias` via `jsPlugins`. Quick fix in chezmoi source at `~/.agents/skills/linting-stack/`. |
| 2 | 23 | Create scaffold skill | Medium | Reusable VSH Pi extension scaffold: mise.toml, lefthook.yml, .oxlintrc.json, biome.json, tsconfig.json, AGENTS.md/CLAUDE.md patterns. For all pi-ecosystem repos. |
| 3 | 16 | Update TS type-safety + linting skills | Medium | Missing guidance discovered this session. Done together with #22 since both are chezmoi-managed skill updates. |
| 4 | 6 | Sanitize + publish to npm | Medium | Needs history rewrite (secrets), GitHub repo creation, npm publish. Done after skill updates so published repo has correct tooling docs. |

### Deferred

| # | Task | Notes |
|---|------|-------|
| 13 | Use probe tools for verification | Replace `node -e` scripts with probe_eval in tests |
| 18 | Evaluate pi-components SettingsPanel | For command.ts TUI panel refactor |
| 19 | Integration tests | Local qualitative compaction validation |

### Resolved this session

- ✅ **Biome test warnings** — all 13 eliminated. `noNonNullAssertion` replaced with explicit null guards, `noExplicitAny` replaced with `Record<string, unknown>` or typed assertions. Zero warnings now.
- ✅ **`examples/templates/` duplication** — replaced with symlink to `src/template/templates/`. Single source of truth, tests pass.
- ℹ️ **`_emit` for idle-path `sendCustomMessage`** — not a concern for the streaming implementation. `chat-message.ts` uses `pi.sendMessage()` (the public API) which fires during the compaction handler's `start()` call. The `session_compact` hook handles cleanup. The streaming path is fully wired: `start()` → `sendMessage` → `update()` → dual mutation + `requestRender` → `finish()` → phase transition. No idle-path edge case applies.
