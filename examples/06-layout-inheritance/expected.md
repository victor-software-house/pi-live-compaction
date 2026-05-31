[live-compaction template, engine: liquid]
<previous-summary>
Earlier session shipped foo.
</previous-summary>

<discarded-conversation>
[User]: Continue work on foo.

[Assistant]: Working.
</discarded-conversation>

<kept-tail>
[User]: Add a benchmark.
</kept-tail>

<files-touched>
## Files touched
R=read, W=write, E=edit, M=move/rename, D=delete

```text
RE  src/foo.ts
```
</files-touched>

<focus>
/compact --preset deep
</focus>

<latest-user-ask>
Add a benchmark.
</latest-user-ask>
[end of compaction context — model output begins next]
