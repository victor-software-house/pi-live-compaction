# Update typescript-type-safety and linting-stack skills

## Gaps discovered this session

### typescript-type-safety skill

1. **No strip-only TS guidance.** Pi extensions use jiti (no build step).
   Parameter properties, enums, and namespaces are forbidden — they require
   a full TypeScript transform, not just type stripping. This is a critical
   constraint for pi-ecosystem work and any project using `--experimental-strip-types`,
   tsx, jiti, or swc in strip mode.

2. **No `findLast`/ES2023 lib note.** `findLast` (used extensively in
   pi-live-compaction) requires `lib: ["ES2023"]` or higher in tsconfig.
   The skill's tsconfig reference jumps straight to ES2024 but never
   mentions the ES2023 array methods or when to use which lib level.

3. **No `verbatimModuleSyntax` mention.** The tsconfig reference uses
   `isolatedModules: true` but doesn't mention `verbatimModuleSyntax`
   which is the modern replacement and what Pi extension projects actually
   use. With `verbatimModuleSyntax`, `import type` is enforced at the
   syntax level — stronger guarantee than `isolatedModules`.

4. **tsconfig reference only covers bundler moduleResolution.** Pi
   extensions use `module: "Node16"` / `moduleResolution: "Node16"` (no
   bundler, jiti resolves directly). The reference should cover both
   patterns: bundler (apps/libraries with build step) and Node16
   (extensions/scripts loaded directly).

5. **Zod via oxlint jsPlugins not mentioned as alternative to ESLint.**
   The skill mandates ESLint for Zod rules. Now that oxlint supports
   `eslint-plugin-zod` via `jsPlugins`, the simpler path is oxlint-only
   (no ESLint needed). The skill should present both options:
   - oxlint `jsPlugins` with `eslint-plugin-zod` (simpler, faster)
   - ESLint with `eslint-plugin-zod` (if you need ESLint for other reasons)

### linting-stack skill (minor additions after #22 fix)

6. **No guidance on type-aware oxlint rules.** The skill's oxlint rules
   reference doesn't mention type-aware rules like `no-floating-promises`,
   `no-misused-promises`, `await-thenable`, `strict-boolean-expressions`,
   `no-unsafe-*` family. These are the highest-value TS rules and the
   canonical `.oxlintrc.json` from pi-live-compaction enables them all.

7. **No `tsconfigPath` setting documented.** Type-aware oxlint rules need
   `settings.typescript.tsconfigPath` in `.oxlintrc.json` (or oxlint
   auto-detects if `tsconfig.json` is at root). Should be mentioned.

## Files to change

### typescript-type-safety (chezmoi source)

| File | Change |
|---|---|
| `readonly_SKILL.md` | Add strip-only TS section in Core Principles. Add note about oxlint jsPlugins as Zod alternative. |
| `references/tsconfig-strict.md` | Add Node16 variant for no-build projects. Add `verbatimModuleSyntax`. Note ES2023 lib for `findLast`. |

### linting-stack (chezmoi source)

| File | Change |
|---|---|
| `rules/readonly_oxlint-typescript-rules.md` | Add "Type-aware rules" section with the `no-floating-promises` / `no-unsafe-*` family. Note `tsconfigPath` setting. |

## What NOT to change

- Zod patterns, ts-pattern, type-guards refs — those are current
- Library versions — recently updated (2026-05-28)
- The linting-stack SKILL.md body and template — already fixed in #22

## Workflow

1. Edit chezmoi source (3 files)
2. `chezmoi diff` scoped to both skills
3. `chezmoi apply` both skills
4. `git commit && git push` chezmoi
