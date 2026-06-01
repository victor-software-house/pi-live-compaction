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

### 1. Clean up plan dir

`plan/` has session-specific plans. Remove from repo — they served their
purpose. Or `.gitignore` them. Decision: delete — git history preserves them.

### 2. Update src/AGENTS.md compat shim note

`src/AGENTS.md` still mentions compat shims that were deleted. Remove that
section.

### 3. Verify package contents

```bash
pnpm pack --dry-run
```

Ensure only `src/`, `examples/`, `bin/`, `README.md`, `CHANGELOG.md`, `LICENSE`
are included. No `test/`, `plan/`, `docs/`, `.github/`, config files.

### 4. Create GitHub repo

```bash
gh repo create victor-software-house/pi-live-compaction \
  --private --source=. --push \
  --description "Live streaming compaction extension for Pi"
```

Private initially — publish as public when ready for npm.

### 5. Create initial changeset + CHANGELOG.md

```bash
pnpm changeset
# Select major/minor/patch, write summary
pnpm changeset version
```

### 6. Verify all gates

```bash
pnpm run verify  # typecheck + lint + test
```

### 7. Tag + push

```bash
git tag v0.1.0
git push --tags
```

### 8. Publish to GitHub Packages

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
