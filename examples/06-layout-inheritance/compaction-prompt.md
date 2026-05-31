---
description: The main template only fills in {% block content %}. Everything else lives in the layout.
---
{% layout '_base' %}

{% block content %}
{% xml "previous-summary" %}{{ previous_summary }}{% endxml %}

<discarded-conversation>
{{ discarded }}
</discarded-conversation>

<kept-tail>
{{ kept_tail }}
</kept-tail>

{% xml "files-touched" %}{{ files_touched }}{% endxml %}

{% xml "focus" %}{{ focus }}{% endxml %}
{% endblock %}
