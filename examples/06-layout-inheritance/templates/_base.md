{% comment %}
Layout: every compaction prompt that extends `_base` gets the same
preamble, anchor, and trailing reminder, with only the `content` block
varying. Override `head` or `tail` to customise scaffolding too.
{% endcomment %}
{% block head %}
[live-compaction template, engine: liquid]
{% endblock %}
{% block content %}
{# main payload — overridden by the extending template #}
{% endblock %}

{% if last_user_message | present %}
<latest-user-ask>
{{ last_user_message | truncate: 800 }}
</latest-user-ask>
{% endif %}
{% block tail %}
[end of compaction context — model output begins next]
{% endblock %}
