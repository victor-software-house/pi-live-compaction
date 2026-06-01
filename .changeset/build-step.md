---
"pi-live-compaction": patch
---

Add tsdown build step for proper npm module resolution. Path aliases now resolve at build time via dist/ output instead of relying on jiti to read tsconfig paths.
