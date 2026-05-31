---
preset: deep
---
<discarded-conversation>
{{ discarded }}
</discarded-conversation>

<kept-tail>
{{ kept_tail }}
</kept-tail>

{% if last_user_message | present %}
<latest-user-ask>
{{ last_user_message }}
</latest-user-ask>
{% endif %}
