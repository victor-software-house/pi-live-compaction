# ADR 005: oxlint jsPlugins for import-alias and zod

**Status:** Accepted
**Date:** 2026-05-31

## Context

The linting-stack skill originally documented `import-alias` and `zod` as
built-in oxlint plugins listed in the `plugins` array alongside `typescript`,
`unicorn`, `import`, etc. This was wrong — neither is a built-in oxlint plugin.

oxlint's CLI `--help` confirms built-in plugins: `typescript`, `unicorn`,
`import`, `promise`, `node`, `oxc`, `react`, `jsdoc`, `jest`, `vitest`.
There is no `--import-alias-plugin` or `--zod-plugin` flag.

## Decision

Load both via oxlint's `jsPlugins` mechanism:

```jsonc
{
  "plugins": ["typescript"],
  "jsPlugins": [
    { "name": "@limegrass/import-alias", "specifier": "@limegrass/eslint-plugin-import-alias" },
    { "name": "zod", "specifier": "eslint-plugin-zod" }
  ]
}
```

Rule names use the jsPlugin prefix:
- `@limegrass/import-alias/import-alias` (not `import-alias/no-relative-paths`)
- `zod/require-strict`, `zod/prefer-enum`, etc. (prefix matches `name` field)

Both npm packages added to `devDependencies`.

## Consequences

- The linting-stack skill, typescript-type-safety skill, and
  pi-extension-scaffold skill templates were all updated.
- No separate `settings` block needed for import-alias — it reads from
  tsconfig `paths` directly.
- `eslint-plugin-zod` can be used via oxlint jsPlugins OR via ESLint — oxlint
  is simpler (no ESLint config needed).
