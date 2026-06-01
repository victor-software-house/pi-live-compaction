# ADR 002: Domain Subdirectory Structure (Option A)

**Status:** Accepted
**Date:** 2026-05-31

## Context

The original layout was a flat `extensions/live-compaction/` directory with
several files exceeding 400 LOC (up to 1176 LOC). No progressive disclosure
for agents — all source in one directory.

Three options were evaluated:
- **Option A:** 8 fine-grained domain subdirs (pi-ssh-tools pattern)
- **Option B:** 5 coarser subdirs (core bundles related domains)
- **Option C:** Minimal nesting (only split what's big)

## Decision

**Option A** — `src/` with 8 domain subdirectories: `compaction/`, `branch/`,
`config/`, `preset/`, `command/`, `files-touched/`, `summary/`, `template/`.

Each subdir has:
- `index.ts` barrel re-exports
- `AGENTS.md` domain guide
- `CLAUDE.md` one-line shim

## Consequences

- Max file: 395 LOC (`command/panel.ts`). All files ≤ 400 LOC.
- Progressive disclosure: agents load only the AGENTS.md they need.
- Domain independence: `files-touched` knows nothing about `compaction`,
  `config` knows nothing about TUI.
- Higher navigation depth (8 dirs) — justified by domain count and
  file count per domain.
- `@live-compaction/*` path aliases resolve through barrel indexes.
