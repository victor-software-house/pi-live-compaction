# files-touched/ domain

File-touch manifest extraction from Pi session history.

## Key exports

| File | Exports |
|---|---|
| `types.ts` | `FileTouchOperation`, `FilesTouchedEntry`, `FileTrackingAction` |
| `tokenizer.ts` | `tokenizeShellCommand`, `splitShellCommands`, `stripShellCommandWrappers`, `extractShellOperands` |
| `parsers.ts` | `parseBashActions`, `parseRpExecActions`, `getTrackedToolActions`, `firstDefinedString` |
| `paths.ts` | Path normalization, root mapping, display path calculation |
| `collector.ts` | `collectFilesTouched` — two-pass session entry collector |
| `manifest.ts` | `renderFilesTouchedManifestBlock`, `formatManifestOperations` |

## Notes

- Two-pass algorithm: pass 1 records tool call intentions from assistant messages; pass 2 confirms via tool result messages (skips no-op edits).
- Root mapping infers `root:relative` path notation from absolute paths in session history.
- Display path logic: strips cwd prefix → falls back to repo root detection via `.git` walk.
- Move redirects chain: if a file was moved, all touches track the final canonical path.
- `manifest.ts` is Pi-runtime-free; safe to import in tests and the preview CLI.
