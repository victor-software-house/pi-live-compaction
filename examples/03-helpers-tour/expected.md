=== `{% xml "tag" %}…{% endxml %}` block tag — wraps body, omits empty ===
<discarded-conversation>
[User]: Long opening request that goes well past the truncate budget intentionally so we can verify the helper truncates with an ellipsis suffix at the configured boundary correctly.

[Assistant]: Acknowledged. Working on it.

[User]: Quick follow-up.

[Assistant]: Done.
</discarded-conversation>

=== Liquid built-in `truncate: N` — chars + " …" ellipsis ===
[User]: Long opening request that goes well past the truncate budget intentio...

=== Liquid built-in `truncatewords: N` — by word, no broken words ===
[User]: Long opening request that goes well past the truncate...

=== `quote` filter — escapes quotes, trims ===
"Final ask: ship it."

=== `tokens` filter — chars/4 estimate ===
discarded ≈ 68 tokens
kept_tail ≈ 7 tokens

=== Liquid `where:` for declarative role filtering ===
discarded user count: 2
discarded asst count: 2

=== Liquid `slice` to take last item, then `text` filter ===
last user in discarded: "Quick follow-up."

=== `last_user_text` — newest non-empty user text across groups ===
"Final ask: ship it."

=== Liquid `==` operator for equality (no need for an `eq` helper) ===
preset is deep: no
=== `present` filter — boolean for non-empty strings/arrays ===
focus present: no
=== stats — counts populated by the runner ===
discarded messages: 4
kept_tail messages: 1
discarded chars:    271
kept_tail chars:    27
