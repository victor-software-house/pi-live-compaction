{% xml "previous-summary" %}{{ previous_summary }}{% endxml %}

<discarded-conversation>
{{ discarded | default: "(none)" }}
</discarded-conversation>

<kept-tail>
{{ kept_tail | default: "(none)" }}
</kept-tail>

{% xml "task-state" %}{{ task_state }}{% endxml %}

{% xml "files-touched" %}{{ files_touched }}{% endxml %}

{% xml "focus" %}{{ focus }}{% endxml %}
