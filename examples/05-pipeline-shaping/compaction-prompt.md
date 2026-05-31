---
description: Declarative shaping with Liquid built-ins — no imperative {% raw %}{% if %}/{% for %}{% endraw %} ceremony.
---
=== last 3 user asks across the whole branch ===
{%- assign all_users = discarded_messages | concat: kept_tail_messages | where: "role", "user" -%}
{%- assign last_three = all_users | slice: -3, 3 -%}
{% for u in last_three %}- {{ u | text | truncate: 60 }}
{% endfor %}

=== first user ask in the discarded span (chronological anchor) ===
{{ discarded_messages | where: "role", "user" | first | text | quote }}

=== budget summary ===
{{ all_users | size }} user messages total
{{ stats.discarded_messages }} discarded / {{ stats.kept_tail_messages }} kept
≈ {{ discarded | tokens }} discarded tokens
≈ {{ kept_tail | tokens }} kept_tail tokens

=== latest user ask, single line, hard char cap ===
{{ last_user_message | replace: "\n", " " | truncate: 80 | quote }}
