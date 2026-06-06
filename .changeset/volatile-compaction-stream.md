---
"pi-live-compaction": patch
---

Render the live compaction stream as a volatile in-memory message so it disappears after Pi's native compaction rebuild without persisting a stream row, and patch the live Pi runtime rather than any package-local Pi copy.
