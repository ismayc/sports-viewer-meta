# Findings

Human-readable copies of durable, hard-won findings, mirrored from the machine-local memory
so they survive on GitHub and reach other machines. Each has a matching memory entry of the
same slug.

| Date | Finding |
|---|---|
| 2026-07-21 | [The family's game deep-link convention](game-deeplink-convention.md) — `?game=<espn id>` one-shot in all six viewers; `?team=` is singular; growing `readState()` breaks three deep-equal tests per fork. |
| 2026-07-21 | [ESPN scoreboard date-range look-ahead](espn-scoreboard-range-lookahead.md) — a range query returns games across the whole window (earliest included); use it for a multi-day "next up" look-ahead. |
