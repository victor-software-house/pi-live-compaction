<discarded-conversation>
{{ discarded | default: "(none)" }}
</discarded-conversation>

<kept-tail>
{{ kept_tail | default: "(none)" }}
</kept-tail>

{% xml "files-touched" %}{{ files_touched }}{% endxml %}
