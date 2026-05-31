# command/ domain

`/live-compaction` slash command and TUI settings panel.

## Key export

`registerLiveCompactionCommand(pi)` — registers the command with Pi's extension API.

## Subcommands

| Subcommand | Action |
|---|---|
| *(no args)* | Opens interactive TUI settings panel (`hasUI` required) |
| `show` | Notify current state summary |
| `verify` | Validate config against model registry |
| `path` | Print global/project root directories |
| `reset` | Delete all config/prompt files for a scope |
| `help` | Print usage text |

## Files

| File | Responsibility |
|---|---|
| `completions.ts` | `getSubcommandCompletions`, command constants |
| `panel.ts` | `createPanelItems`, `syncPanelItems`, `createSelectionSubmenu`, describe helpers |
| `handlers.ts` | `openPanel`, `managePreset`, `editPrompt`, `resetPrompt`, `pickInitialScope` |
| `index.ts` | `registerLiveCompactionCommand` |

## Notes

- Panel scope is `LiveCompactionController`-driven; the controller handles all config mutations.
- `PanelExternalAction` carries the action signalled by the panel (preset CRUD, prompt edit/reset) back to `openPanel` for processing.
