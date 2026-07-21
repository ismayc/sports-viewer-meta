# sports-viewer-meta — working context

Shared framework extracted from three working apps, so NBA and NFL viewers don't start
from scratch. Read `docs/PLAYBOOK.md` before writing code — it is three builds' worth of
hard-won lessons and it outranks anything you'd infer from the source.

## Sibling repos (the source of truth for patterns)

All family repos now live together under `~/repos/sports-trackers/` (a plain container folder,
not itself a git repo). Each app is still its own independent GitHub repo.

| Repo | Role |
|---|---|
| `~/repos/sports-trackers/world-cup-viewer` | oldest, most features; groups + knockout bracket |
| `~/repos/sports-trackers/premier-league` | 271 tests at **100% coverage**; points table, 34 seasons of history |
| `~/repos/sports-trackers/the-wnba-schedule` | newest; series bracket, live alerts, quarter line scores |
| `~/repos/sports-trackers/the-nba-schedule` | conference playoff bracket; base for the March Madness viewers |
| `~/repos/sports-trackers/the-nfl-schedule` | week axis; 100% coverage |
| `~/repos/sports-trackers/hub` | the family page — which viewers have games today (its own repo) |

When adding anything, **check how the siblings did it first and match** — Chester
maintains these as a deliberate family and asks for consistency explicitly. Deviate only
when the sport demands it, and say why.

## The architecture, in one paragraph

A build-time script writes the whole season into `src/data/*.js`. The app renders it with
**zero network requests**. A live overlay polls the same ESPN endpoint and merges over the
top, joined on shared event ids. Standings, tables, brackets, and stats are all *derived*
from the committed snapshot — so a bad refresh fails a test rather than quietly rendering
a wrong table.

Two rules make the merge correct, and both are load-bearing:

1. **A score is written to the snapshot only for a completed game.** In-progress scores
   are transient and belong to the overlay.
2. **The merge copies only defined values**, so a feed omitting a field can never blank a
   field the snapshot holds.

## House rules

- **`scripts/` imports Node built-ins and relative paths only** — the refresh workflow runs
  with no `npm ci`. A CI grep job enforces it. (Relative imports ARE allowed; both prior
  builds wrongly duplicated helpers because they misread this.)
- **No API keys, no backend, no `.env`.** Every feed is keyless and CORS-open. If a design
  needs a secret, it is the wrong design.
- **Verify effects, not reports.** See PLAYBOOK §6 — five real cases where a green signal
  meant nothing was happening.
- **Never invent precision.** The feeds expose no possession counts and no xG. Name things
  literally: *points per game*, *goal difference*, *scoring margin* — never "efficiency
  rating".
- Plain JSX, no TypeScript. React 18 + Vite. No router — the view is a `useState` string.
  Single global `index.css` with CSS custom properties.

## Commands

```bash
node scripts/gen-adapter.mjs --league nba --path basketball/nba --season 2026
node test/smoke.mjs     # hits the live API; proves all three standings models
```

## State

See `docs/STATE.md` for what is done, what is known-wrong, and what is next.
