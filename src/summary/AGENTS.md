# summary/ domain

LLM completion wiring for compaction summaries.

## Key exports

| File | Exports |
|---|---|
| `constants.ts` | `SYSTEM_PROMPT`, `buildSummaryOptions`, `buildSummaryRequestMessage`, `toReasoningLevel`, `chooseSummaryTransport` |
| `stream.ts` | `completeWithResolvedSummarizer`, `getTextFromAssistantResponse`, `stripLeakedInternals` |

## Notes

- `completeWithResolvedSummarizer` handles both `complete` and `streamSimple` paths; falls back to `deps.complete` when no streaming function is registered.
- Stream recovery: if the stream errors mid-flight but partial text was collected, `recoverStreamedSummary` returns a synthetic `AssistantMessage` with a `live-compaction-stream-recovered` diagnostic.
- `stripLeakedInternals` filters `[Assistant thinking]:` / `[Assistant tool calls]:` / `[Tool result]:` lines from the final summary.
