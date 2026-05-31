---
description: Task continuity contract for multi-step work and pi-tasks reconciliation.
preset: deep
---
{% xml "previous-summary" %}{{ previous_summary }}{% endxml %}

<discarded-conversation>
{{ discarded | default: "(none)" }}
</discarded-conversation>

<kept-tail>
{{ kept_tail | default: "(none)" }}
</kept-tail>

{% xml "focus" %}{{ focus }}{% endxml %}

{% if last_user_message | present %}
<latest-user-ask>
{{ last_user_message | truncate: 800 }}
</latest-user-ask>
{% endif %}

# What to include

## Status
Use [DONE], [IN PROGRESS], [TODO], [BLOCKED], [FAILED], [UNVERIFIED].

## Task continuity
For multi-step work, preserve detailed tasks with status, dependencies, and acceptance criteria. Current-focus tasks first. Sidetracks and deferred follow-up TODOs lower priority. pi-tasks is useful operational state, not gospel: agents forget to create tasks, update statuses, or clear stale tasks. Tell the next agent to run TaskRead on resume, compare it against transcript evidence, then use TaskWrite to create missing tasks, fix stale statuses/blockers, or delete stale tasks.

## Immediate next steps
Concrete next actions in order, aligned with `<latest-user-ask>`.
