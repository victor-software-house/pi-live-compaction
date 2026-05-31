# template/ domain

Liquid template loading, render-variable builders, and built-in template singletons.

## Key exports

| File | Exports |
|---|---|
| `types.ts` | `CompactionTemplateFrontmatter`, `CompactionRenderVars`, `BranchSummaryRenderVars` |
| `loader.ts` | `loadCompactionTemplate`, `loadCompactionTemplateFromString`, `CompactionTemplate`, `CompactionTemplateError`, `getBuiltInCompactionTemplate`, `getBuiltInBranchSummaryTemplate` |
| `render-vars.ts` | `buildRenderVars`, `buildBranchSummaryRenderVars` |

## Notes

- `loadCompactionTemplate(path)` returns `null` on ENOENT (no template file) — callers fall back to built-in.
- Built-in singletons (`getBuiltIn*Template()`) are lazy and reused across calls.
- `templates/` directory contains shipped partial templates (`_blocks.md`, `_contract.md`); these are resolved by Liquid relative to the user template file's directory.
- Frontmatter keys: `preset`, `thinkingLevel` / `thinking_level`, `model`, `description`.
