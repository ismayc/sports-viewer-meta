# Findings

Human-readable copies of durable, hard-won findings, mirrored from the machine-local memory
so they survive on GitHub and reach other machines. Each has a matching memory entry of the
same slug.

| Date | Finding |
|---|---|
| 2026-07-21 | [The family's game deep-link convention](game-deeplink-convention.md) — `?game=<espn id>` one-shot in all six viewers; `?team=` is singular; growing `readState()` breaks three deep-equal tests per fork. |
| 2026-07-21 | [ESPN scoreboard date-range look-ahead](espn-scoreboard-range-lookahead.md) — a range query returns games across the whole window (earliest included); use it for a multi-day "next up" look-ahead. |
| 2026-07-22 | [The Actions token is read-only by default](actions-token-read-only.md) — pushing/PR-opening workflows need their own `permissions:` block, and a skipped conditional step hides the breakage behind green runs. |
| 2026-07-22 | [ESPN's per-player match log for soccer](espn-soccer-player-log.md) — `/gamelog` 500s and the log hides in `/overview`; keepers get different columns, `score` is winner-first, and the list is last-five-overall rather than per-competition. |
