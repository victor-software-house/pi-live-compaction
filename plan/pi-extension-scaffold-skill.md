# Create `pi-extension-scaffold` skill

## Goal

Chezmoi-managed skill that scaffolds a new VSH Pi extension project with
canonical tooling. Triggered when creating a new pi-ecosystem repo or
aligning an existing repo to the baseline.

## Location

Chezmoi source: `~/.local/share/chezmoi/exact_dot_agents/exact_skills/pi-extension-scaffold/`
Rendered target: `~/.agents/skills/pi-extension-scaffold/`

## Skill structure

```
pi-extension-scaffold/
├── SKILL.md                     — entry point, checklist, workflow
├── templates/                   — copy-paste scaffold files
│   ├── mise.toml                — Node 24, lefthook, pnpm
│   ├── lefthook.yml             — pre-commit, commit-msg, pre-push
│   ├── oxlintrc.json            — canonical (from linting-stack fix)
│   ├── biome.json               — tabs, single quotes, 100-col
│   ├── tsconfig.json            — strict, strip-only, ES2023, path aliases
│   ├── vitest.config.ts         — path alias resolution
│   ├── commitlint.config.mjs    — conventional commits
│   ├── changeset-config.json    — changesets for versioning
│   ├── ci.yml                   — GitHub Actions CI workflow
│   ├── release.yml              — GitHub Actions release workflow
│   ├── AGENTS.md                — root AGENTS.md template
│   └── CLAUDE.md                — one-line shim template
└── references/
    └── vsh-baseline.md          — VSH Pi Package Baseline (from workspace AGENTS.md)
```

## SKILL.md content outline

### Frontmatter

```yaml
name: pi-extension-scaffold
description: |
  Scaffold a new VSH Pi extension project with canonical tooling.
  Use when creating a pi-ecosystem repo, aligning an existing repo
  to the VSH baseline, or auditing tooling completeness.
```

### Body — interactive checklist workflow

The skill body walks through each scaffold file with:
1. **Check** — does the file exist? Is it current?
2. **Copy** — from `templates/` if missing
3. **Adapt** — fill in project-specific values (package name, path aliases,
   extension entry point, peer dep versions)

#### Checklist

- [ ] `mise.toml` — Node version, lefthook, pnpm
- [ ] `lefthook.yml` — pre-commit (format + lint + typecheck), commit-msg
      (commitlint), pre-push (verify)
- [ ] `.oxlintrc.json` — `plugins: ["typescript"]`, `jsPlugins` for
      import-alias + zod, type-aware rules
- [ ] `biome.json` — tabs, single quotes, 100-col, test overrides
- [ ] `tsconfig.json` — strict, strip-only TS, `lib: ["ES2023"]`,
      `@<pkg>/*` path aliases
- [ ] `vitest.config.ts` — alias resolution matching tsconfig paths
- [ ] `commitlint.config.mjs` — `@commitlint/config-conventional`
- [ ] `.changeset/config.json` — changesets versioning
- [ ] `package.json` fields — `pi.extensions`, `files`, `engines`,
      `packageManager`, peer deps, `scripts.verify`
- [ ] `.github/workflows/ci.yml` — verify on push/PR
- [ ] `.github/workflows/release.yml` — tag-triggered publish
- [ ] `AGENTS.md` + `CLAUDE.md` — root + nested subdirs

#### Project-specific adaptations

| Template placeholder | What to fill |
|---|---|
| `@<pkg>/*` | tsconfig path alias prefix (e.g. `@live-compaction/*`) |
| `./src/index.ts` | extension entry point |
| `pi-<name>` | package name |
| peer dep versions | current Pi SDK versions |

## Templates — sourced from canonical repos

Each template is the **minimal canonical version** derived from the gold
standard (pi-live-compaction, pi-fast-apply, pi-caveman). Not a copy of
any single repo — a distilled baseline.

### Key differences from linting-stack templates

- `oxlintrc.json` here is **minimal** — only `plugins: ["typescript"]` +
  jsPlugins. No `unicorn`/`import`/`promise` etc. (those are opt-in per
  project, not baseline). The linting-stack skill covers the full-featured
  version.
- `biome.json` includes test overrides for `noExplicitAny` and
  `noNonNullAssertion` (downgraded to `warn`).
- CI/release workflows follow the VSH baseline from workspace AGENTS.md.

## Chezmoi registration

1. Create source dir at `~/.local/share/chezmoi/exact_dot_agents/exact_skills/pi-extension-scaffold/`
2. Add to `[skill_domains]` in `.chezmoidata.toml` with `["all"]` scope
3. `chezmoi diff ~/.agents/skills/pi-extension-scaffold`
4. `chezmoi apply ~/.agents/skills/pi-extension-scaffold`
5. `cd ~/.local/share/chezmoi && git add -A && git commit && git push`

## What this skill is NOT

- Not a CLI generator / `create-*` tool — it's guidance + templates
- Not a replacement for linting-stack — that skill covers rule selection
  and rationale; this skill covers project bootstrap
- Not monorepo-aware — single-package only (monorepo = turborepo skill)
