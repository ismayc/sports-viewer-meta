# ESPN scoreboard date-range look-ahead

_Found 2026-07-21, building the sports-trackers hub's 14-day "what's on next" filter._

## The finding

The ESPN scoreboard accepts a **date range** — `.../scoreboard?dates=YYYYMMDD-YYYYMMDD` —
and, contrary to the fear the [PLAYBOOK](../PLAYBOOK.md)'s "silently caps at ~50 events" note
raises, a range does **not** truncate to the earliest ~50. It returns games **spanning the
whole window, with the earliest always present** (a dense league is merely thinned in the
middle days).

This makes a single range request a good way to get a multi-day **look-ahead** ("next game N
days out"), while accurate **today** counts still want per-day queries.

## Evidence

```
$ # 14-day ranges, in-season, sorted by date:
NBA   20260115-20260129 -> 100 events | first 2026-01-15 | last 2026-01-29
WNBA  20260715-20260729 ->  33 events | first 2026-07-15 | last 2026-07-30
EPL   20260822-20260905 ->  27 events | first 2026-08-22 | last 2026-09-05
NFL   20260721-20260804 ->   0 events (offseason)
```

NBA returned 100 (not ~50, and not just the first few days — the last date is the range end),
so the cap is higher for a range and it spans the window. WNBA/EPL came back complete.

## How it's applied

`hub/src/services/espn.js` fetches, per viewer:

- `[-1, 0, +1]` **single-day** queries → an exact "today" bucket (each day is well under any
  cap; ≤~15 games/day for these leagues), re-bucketed to the viewer's local calendar day.
- one `[+2 … +14]` **range** query → the "next up" look-ahead.

Four requests per viewer instead of sixteen day-queries. Timestamps are ISO-UTC — convert to
the viewer's zone before day-bucketing (a late Pacific tip is a different calendar day east).
