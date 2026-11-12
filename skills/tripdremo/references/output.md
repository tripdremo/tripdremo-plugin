# Plan output

## Compact output

Use compact output for plan creation and `open <share_hash>`:

1. Print the title.
2. Print the inclusive date range and `day_count`.
3. Print one line per returned day: `Day <index>  <title> · <stop_count> stops · <drive_summary>`.
4. Print the absolute, locale-prefixed `share_url` on its own line.
5. If `owner_kind` is `guest`, add one login offer.

Keep a seven-day result to about 40 lines or fewer. Do not bury the share link in a paragraph.

## Full payload

Set `include_payload: true` only when the user explicitly asks for the full payload in natural language while retrieving an existing plan. Return the compact output first, then the tool-provided `trip_payload`. Do not add, infer, normalize, or repair payload fields. Do not add a new public subcommand or flag for this option.

If `include_payload` is false or absent, never dump `trip_payload`, even if the server response contains it.
