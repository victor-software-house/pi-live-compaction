# Sanitize repo and publish to npm

## Current state

- 34 commits, all conventional, clean history
- No secrets/credentials in git history (verified)
- `package.json`: `pi-live-compaction@0.1.0`, no `private` flag
- `repository.url` already points to `victor-software-house/pi-live-compaction`
- `files` field: `["src", "examples", "bin", "README.md", "CHANGELOG.md", "LICENSE"]`
- README.md and LICENSE exist
- No CHANGELOG.md yet
- No GitHub repo yet
- `plan/` dir exists (not in `files` — won't be published)

## Steps

### 1. Write ADRs for key architectural decisions

Before removing `plan/`, extract decisions into proper ADRs at `docs/adr/`:

| ADR | Decision | Source |
|-----|----------|--------|
| `001-chat-flow-streaming.md` | Use `sendMessage` + `registerMessageRenderer` for live compaction display instead of widget-slot or `custom()`. 7-step pattern with dual mutation. | `docs/tui-streaming-patterns.md`, `plan/session-recap.md` |
| `002-domain-subdirectory-structure.md` | Option A: 8 domain subdirs under `src/` with barrel index.ts, ≤400 LOC per file, AGENTS.md progressive disclosure. | Restructure plan, `plan/session-recap.md` |
| `003-theme-colors-for-compaction.md` | `toolPendingBg` during streaming, `customMessageBg` when done (matching Pi native), `session_compact` for cleanup. | `AGENTS.md`, `plan/session-recap.md` |
| `004-strip-only-typescript.md` | No parameter properties, enums, namespaces. `verbatimModuleSyntax` + `isolatedModules`. jiti loads TS directly. | `AGENTS.md` conventions |
| `005-jsPlugins-not-built-in.md` | `import-alias` and `zod` are external ESLint plugins loaded via oxlint `jsPlugins`, not built-in plugins. | `plan/fix-linting-stack-skill.md` |

ADR format: title, status (accepted), date, context, decision, consequences.

### 2. Clean up plan dir

`plan/` has session-specific plans (skill development plans, session recap,
publish plan). Before deleting:

- **Already documented elsewhere:** TUI streaming patterns → `docs/tui-streaming-patterns.md`.
  Architecture decisions → `docs/adr/` (created in step 1).
  Module layout → `src/AGENTS.md`.
- **Skill plans (#22, #23, #16):** executed and committed to chezmoi. The plans
  themselves are implementation notes, not reference docs.
- **Session recap:** architectural flow diagrams are in `docs/tui-streaming-patterns.md`.
  Commit history preserves the full recap in git.

Decision: delete `plan/` dir. All durable knowledge lives in `docs/`, `AGENTS.md`,
and git history. Nothing is lost.

### 3. Update src/AGENTS.md compat shim note

`src/AGENTS.md` still mentions compat shims that were deleted. Remove that
section.

### 4. Verify package contents

```bash
pnpm pack --dry-run
```

Ensure only `src/`, `examples/`, `bin/`, `README.md`, `CHANGELOG.md`, `LICENSE`
are included. No `test/`, `plan/`, `docs/`, `.github/`, config files.

### 5. Create GitHub repo

```bash
gh repo create victor-software-house/pi-live-compaction \
  --private --source=. --push \
  --description "Live streaming compaction extension for Pi"
```

Private initially — publish as public when ready for npm.

### 6. Set up changesets workflow

For the **first release only**, bootstrap manually:

```bash
pnpm changeset
pnpm changeset version
# This creates CHANGELOG.md from the changeset
```

For **ongoing releases**, add the changesets GitHub Action workflow
(`.github/workflows/release-please.yml` or similar) that:
1. Collects changesets from PRs
2. Opens a "Version Packages" PR automatically
3. Merging the PR bumps version + updates CHANGELOG.md
4. Tag push triggers the existing `release.yml` publish workflow

No VSH repo currently uses the changesets PR workflow — this would be the
first. For v0.1.0 bootstrap, manual changeset is fine. Add the CI workflow
as a fast follow.

### 7. Verify all gates

```bash
pnpm run verify  # typecheck + lint + test
```

### 8. Tag + push

```bash
git tag v0.1.0
git push --tags
```

### 9. Publish to GitHub Packages

Release workflow triggers on tag push. Or manual:

```bash
pnpm publish --no-git-checks --access public
```

## Publish config

The package should be **public npm** (not GitHub Packages restricted).
Verify `publishConfig` in package.json:

```json
{
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org"
  }
}
```

This is a community Pi extension — no private VSH deps. Public npm is
the right registry.

## Pre-publish checklist

- [ ] `plan/` dir removed or gitignored
- [ ] `src/AGENTS.md` compat shim note removed
- [ ] `pnpm pack --dry-run` shows only intended files
- [ ] GitHub repo created (private → public when ready)
- [ ] CHANGELOG.md generated via changesets
- [ ] All gates pass
- [ ] Tagged v0.1.0
- [ ] Published to npm
