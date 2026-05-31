# config/ domain

Config schema, file I/O, path resolution, and prompt contract management.

## Key exports

| File | Exports |
|---|---|
| `schema.ts` | Types (`ThinkingLevel`, `LiveCompactionConfig`, …), `DEFAULT_CONFIG`, `CURRENT_PRESET_SENTINEL`, `parseConfig`, `normalizeThinkingLevel` |
| `io.ts` | `resolveLiveCompactionPaths`, `loadEffectiveConfig`, `loadScopedConfig`, `saveScopedConfig`, scope helpers |
| `prompts.ts` | `DEFAULT_COMPACTION_PROMPT_CONTRACT`, `DEFAULT_COMPACTION_TEMPLATE_BODY`, prompt I/O (`resolveEffectivePrompt`, `loadEffective*PromptContract`, …) |

## Notes

- `resolveLiveCompactionPaths(cwd?)` → `{ global: { rootDir, configPath, … }, project? }` — always relative to `getAgentDir()`, never to the source dir.
- Scope resolution: project config wins over global when present; fallback to `DEFAULT_CONFIG`.
- `loadConfig(extensionDir?)` is legacy — prefer `loadEffectiveConfig`.
