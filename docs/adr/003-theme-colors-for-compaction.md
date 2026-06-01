# ADR 003: Theme Colors for Compaction Phases

**Status:** Accepted
**Date:** 2026-05-31

## Context

The compaction chat message transitions through phases (streaming → done).
Each phase needs a distinct background color. Pi's theme system provides
semantic color keys via `theme.bg(key)`.

## Decision

| Phase | Background key | Rationale |
|-------|---------------|-----------|
| Streaming | `toolPendingBg` | Same as in-progress tool calls — consistent "working" signal |
| Done | `customMessageBg` | Same as Pi's native `CompactionSummaryMessageComponent` — seamless handoff |
| Error | `toolErrorBg` | Standard error visual |

Cleanup via `pi.on('session_compact')` — fires before `rebuildChatFromMessages`,
sets `entry.display = undefined` so Pi's native compaction summary takes over.

## Consequences

- Colors match Pi's native compaction rendering — no visual seam on handoff.
- Never hardcode RGB values — all colors from `theme.bg(key)`.
- The `customMessageBg` choice was corrected from an earlier `toolSuccessBg`
  mistake after comparing with Pi's native code.
