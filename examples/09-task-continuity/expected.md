
<discarded-conversation>
[User]: Investigate WebSocket reliability and make compaction recoverable.

[Assistant]: Created tasks for SSE transport, prompt updates, persistent suggestions, and modularization.
</discarded-conversation>

<kept-tail>
[User]: Update the compaction template to make sure we add detailed tasks with pi-tasks if not already existing.
</kept-tail>

<focus>
continue current compaction reliability work; keep sidetracks as lower-priority TODOs
</focus>

<latest-user-ask>
Update the compaction template to make sure we add detailed tasks with pi-tasks if not already existing.
</latest-user-ask>

# What to include

## Status
Use [DONE], [IN PROGRESS], [TODO], [BLOCKED], [FAILED], [UNVERIFIED].

## Task continuity
For multi-step work, preserve detailed tasks with status, dependencies, and acceptance criteria. Current-focus tasks first. Sidetracks and deferred follow-up TODOs lower priority. pi-tasks is useful operational state, not gospel: agents forget to create tasks, update statuses, or clear stale tasks. Tell the next agent to run TaskRead on resume, compare it against transcript evidence, then use TaskWrite to create missing tasks, fix stale statuses/blockers, or delete stale tasks.

## Immediate next steps
Concrete next actions in order, aligned with `<latest-user-ask>`.
