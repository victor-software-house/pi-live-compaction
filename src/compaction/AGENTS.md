# compaction/ domain

Main compaction handler and orchestration pipeline.

## Key exports

| File | Exports |
|---|---|
| `handler.ts` | `runLiveCompaction`, `DEFAULT_DEPS`, `fetchTaskStateSnapshot` (re-export) |
| `orchestrator.ts` | `summarizeWithResolvedModel`, `executeSummaryCall` |
| `progress.ts` | `makeSummaryProgress`, `fetchTaskStateSnapshot`, `boundTaskStateBlock`, `notify` |
| `result.ts` | `buildSuccessResult`, `collectKeptTailMessages` |

## Flow

```
runLiveCompaction
  ├── parseCompactInstructions       (preset/)
  ├── loadConfig / loadCompactionPrompt / loadCompactionTemplate
  ├── resolveDefaultSummarizer / resolvePresetSummarizer  (preset/)
  └── summarizeWithResolvedModel
        ├── collectKeptTailMessages  (result.ts)
        └── executeSummaryCall
              ├── buildRenderVars    (template/)
              └── completeWithResolvedSummarizer  (summary/)
```

## Notes

- `DEFAULT_DEPS` wires production-ready default dependencies; tests inject stubs.
- Preset path and default path share the same `summarizeWithResolvedModel` call.
- `fetchTaskStateSnapshot` uses the Pi events bus with a 750 ms timeout.
- `makeSummaryProgress` returns `undefined` when no UI is available (headless mode).
