---
description: Demonstrates the {% xml %} block tag — emits nothing when the body is empty.
preset: deep
---
{% xml "previous-summary" %}{{ previous_summary }}{% endxml %}

<discarded-conversation>
{{ discarded }}
</discarded-conversation>

<kept-tail>
{{ kept_tail }}
</kept-tail>

{% xml "files-touched" %}{{ files_touched }}{% endxml %}

{% xml "focus" %}{{ focus }}{% endxml %}

{% if last_user_message | present %}
<latest-user-ask>
{{ last_user_message }}
</latest-user-ask>
{% endif %}
