---
description: Tool-call shape rendering via a sibling _blocks partial.
---
{% include '_blocks' %}

{% if last_user_message | present %}
<latest-user-ask>
{{ last_user_message }}
</latest-user-ask>
{% endif %}
