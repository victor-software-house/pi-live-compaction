# branch/ domain

Branch summary augmentation for the `session_before_tree` hook.

## Key export

`runGroundedBranchSummaryAugmentation(event, ctx, deps?)` — builds and injects a structured branch-summary prompt into Pi's `/tree` flow.

## Notes

- Returns `undefined` (no-op) when the signal is aborted, `userWantsSummary` is false, or `entriesToSummarize` is empty.
- Falls back from template render → `promptContract` text assembly → omit when both are empty.
- `filesTouchedBlock` included when `config.includeFilesTouched.inBranchSummary` is true.
- Uses `DEFAULT_DEPS` from `@live-compaction/compaction`; test-injectable via `deps` param.
