# Fix linting-stack skill: import-alias is jsPlugins, not built-in

## Problem

The linting-stack skill documents `import-alias` as a **built-in oxlint plugin**
listed alongside `typescript`, `unicorn`, `import`, etc. in the `plugins` array.
This is wrong — `import-alias` is NOT a built-in oxlint plugin.

The real package is `@limegrass/eslint-plugin-import-alias`, loaded via oxlint's
`jsPlugins` mechanism:

```jsonc
// WRONG (current skill template)
"plugins": ["typescript", "unicorn", "import", "promise", "node", "oxc", "import-alias", "zod"]

// CORRECT (what pi-live-compaction actually uses)
"plugins": ["typescript"],
"jsPlugins": [
  { "name": "@limegrass/import-alias", "specifier": "@limegrass/eslint-plugin-import-alias" }
],
"rules": {
  "@limegrass/import-alias/import-alias": "error"
}
```

## Files to change

All under `~/.local/share/chezmoi/exact_dot_agents/exact_skills/linting-stack/`:

### 1. `readonly_SKILL.md` (body text)

- Line 34: change `import-alias` plugin description to clarify it's a jsPlugin
  (`@limegrass/eslint-plugin-import-alias` via `jsPlugins`), not built-in
- Line 96: update path-alias section to reference `jsPlugins` + correct rule name

### 2. `rules/oxlint-typescript-rules.md`

- "Required plugins" table: move `import-alias` out of plugins table → new
  "Required jsPlugins" section explaining the `jsPlugins` mechanism
- Rule reference: `import-alias/no-relative-paths` → `@limegrass/import-alias/import-alias`
- Path-alias settings: update `settings.import-alias/aliases` →
  `settings.@limegrass/import-alias/aliases` (or verify correct settings key)
- Line ~73: fix the settings example

### 3. `templates/oxlintrc-strict.json`

- Remove `"import-alias"` from `plugins` array
- Add `jsPlugins` block with `@limegrass/eslint-plugin-import-alias`
- Fix rule name: `import-alias/no-relative-paths` → `@limegrass/import-alias/import-alias`
- Fix settings key: `import-alias/aliases` → correct key for the jsPlugin

## Workflow

1. Edit chezmoi source files (3 files above)
2. `chezmoi diff ~/.agents/skills/linting-stack` — verify changes
3. `chezmoi apply ~/.agents/skills/linting-stack` — apply
4. Verify rendered output matches expectations

## Also consider

- `zod` plugin — verify this is actually a built-in oxlint plugin. If not,
  same fix needed. (Likely built-in via `oxlint-plugin-zod` or similar.)
- `oxlint-tsgolint` mention — verify this is still current / relevant.
- The template still lists plugins like `unicorn`, `import`, `promise`, `node`,
  `oxc` — these are all legit built-in oxlint plugins, no change needed.
