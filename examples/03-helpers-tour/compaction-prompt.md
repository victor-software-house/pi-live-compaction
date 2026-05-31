---
description: Helper tour — every shipped filter + tag + commonly-used Liquid built-ins.
---
=== `{% raw %}{% xml "tag" %}…{% endxml %}{% endraw %}` block tag — wraps body, omits empty ===
{% xml "discarded-conversation" %}{{ discarded }}{% endxml %}
{%- comment -%}
Empty body → entire block suppressed (focus is unset in this case):
{%- endcomment -%}
{% xml "focus" %}{{ focus }}{% endxml %}

=== Liquid built-in `truncate: N` — chars + " …" ellipsis ===
{{ discarded | truncate: 80 }}

=== Liquid built-in `truncatewords: N` — by word, no broken words ===
{{ discarded | truncatewords: 10 }}

=== `quote` filter — escapes quotes, trims ===
{{ last_user_message | quote }}

=== `tokens` filter — chars/4 estimate ===
discarded ≈ {{ discarded | tokens }} tokens
kept_tail ≈ {{ kept_tail | tokens }} tokens

=== Liquid `where:` for declarative role filtering ===
{% assign users = discarded_messages | where: "role", "user" %}
discarded user count: {{ users | size }}
discarded asst count: {{ discarded_messages | where: "role", "assistant" | size }}

=== Liquid `slice` to take last item, then `text` filter ===
{% assign last_user_msg = users | slice: -1, 1 | first %}
last user in discarded: {{ last_user_msg | text | quote }}

=== `last_user_text` — newest non-empty user text across groups ===
{{ kept_tail_messages | last_user_text: discarded_messages | quote }}

=== Liquid `==` operator for equality (no need for an `eq` helper) ===
preset is deep: {% if meta.preset == "deep" %}yes{% else %}no{% endif %}

=== `present` filter — boolean for non-empty strings/arrays ===
focus present: {% if focus | present %}yes{% else %}no{% endif %}

=== stats — counts populated by the runner ===
discarded messages: {{ stats.discarded_messages }}
kept_tail messages: {{ stats.kept_tail_messages }}
discarded chars:    {{ stats.discarded_chars }}
kept_tail chars:    {{ stats.kept_tail_chars }}
