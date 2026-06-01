# ADR 004: Strip-Only TypeScript Compatibility

**Status:** Accepted
**Date:** 2026-05-31

## Context

Pi loads extensions via jiti — a TypeScript loader that performs type
stripping only, without full TypeScript compilation. This means certain
TypeScript syntax features that require code transformation are unavailable.

## Decision

All source code must be strip-only TS compatible:

**Forbidden:**
- Parameter properties (`constructor(private x: number)`)
- `enum` declarations — use `as const` objects or union types
- `namespace` declarations
- `import Foo = require("...")` legacy syntax

**Required tsconfig flags:**
- `verbatimModuleSyntax: true` — enforces `import type` at syntax level
- `isolatedModules: true` — compatibility with all TS loaders
- `module: "Node16"` / `moduleResolution: "Node16"` — jiti resolves directly
- `lib: ["ES2023"]` — minimum for `findLast`, `toReversed`, `toSorted`
- `noEmit: true` — TypeScript is type-checker only, no build output

## Consequences

- No build step needed — Pi loads `.ts` files directly.
- `findLast` (ES2023) used instead of `[...arr].reverse().find()` — native, no copy.
- Types like `Pick<ExtensionUIContext, ...>` used instead of manual `as` casts.
- `import type` enforced by `verbatimModuleSyntax` — catches runtime-invisible imports.
