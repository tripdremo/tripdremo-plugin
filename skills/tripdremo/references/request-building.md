# Planning request construction

## Preserve intent

- Copy the complete raw argument string verbatim into `prompt`, including a leading word such as `plan`, `create`, `get`, `list`, `status`, or `save` when it does not match a locked public subcommand.
- Never put a password, one-time password, authorization token, or CLI credential in an argument.
- Ask one short clarification question only when the destination is genuinely absent.

## Resolve dates

- Produce concrete ISO dates in `YYYY-MM-DD` format.
- Interpret durations as inclusive calendar-day counts: `end_date = start_date + duration - 1`.
- Example: five calendar days starting `2027-07-04` means `start_date: 2027-07-04` and `end_date: 2027-07-08`.
- Resolve a month without a year to the next occurrence of that month relative to today.
- Choose concrete missing dates, state the assumption in the user-facing response, and continue without asking.
- Reject `end_date < start_date`.
- Keep the difference between `end_date` and `start_date` at 45 days or fewer.

## Resolve travelers

- Default to `adults: 2` and `children: []`.
- Convert phrases such as `2 adults + a 6-year-old` to `adults: 2` and `children: [{age: 6}]`.
- Include at most 12 children.
- Keep every child age between 0 and 17.

## Map style

| User phrasing | `style` |
| --- | --- |
| relaxed, slow, easy pace | `relaxed` |
| active, fast, packed | `active` |
| camper, van, RV, self-drive | `camper` |
| luxury, upscale | `luxury` |
| no match | `balanced` |

## Map budget

| User phrasing | `budget` |
| --- | --- |
| budget, value, low-cost | `value` |
| premium, luxury, high-end | `premium` |
| no match | `comfortable` |

Do not mention default traveler, style, or budget values unless they materially affect an explicit user constraint.
