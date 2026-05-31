---
description: Empty kept tail — falls back to `(none)`. last_user_message still resolves via the discarded span (newer arrays first wins).
---
<discarded-conversation>
{{ discarded | default: "(none)" }}
</discarded-conversation>

<kept-tail>
{{ kept_tail | default: "(none)" }}
</kept-tail>

{% if last_user_message | present %}
<latest-user-ask>
{{ last_user_message }}
</latest-user-ask>
{% else %}
<no-latest-user-ask />
{% endif %}
