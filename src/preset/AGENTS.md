# preset/ domain

Preset matching and summarizer resolution.

## Key exports

| File | Exports |
|---|---|
| `matching.ts` | `parseCompactInstructions`, `resolvePresetMatch`, `sha256` |
| `summarizer.ts` | `resolveDefaultSummarizer`, `resolvePresetSummarizer`, `resolveConfiguredFallbackSummarizer`, `getEffectiveThinkingLevel`, `describeConfiguredFallback`, `describePresetFallback` |

## Notes

- `parseCompactInstructions(text?)` — parses `--preset NAME [focus]` directives from `/compact` args.
- Preset key matching is case-insensitive and supports prefix matching; ambiguous matches return `kind: 'ambiguous'`.
- Summarizer resolution consults the model registry to validate model/auth; throws `CompactionAbortedError` if session model is unavailable.
