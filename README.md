# sports-viewer-meta

The shared framework behind a family of seven sports viewers (plus their hub page).
It was extracted from the first three builds so the later ones didn't start from
scratch — and every viewer since has been built by the procedure in
[`docs/NEW-VIEWER.md`](docs/NEW-VIEWER.md).

**Read [`docs/PLAYBOOK.md`](docs/PLAYBOOK.md) first.** The code here is the cheap part;
the playbook is several builds' worth of feed traps, timezone landmines, and
things-that-looked-green-but-weren't.

## The family

| Viewer | Live | Shape / notable features |
|---|---|---|
| [`world-cup-viewer`](https://github.com/ismayc/world-cup-viewer) | [site](https://ismayc.github.io/world-cup-viewer/) | The original. World Cup 2026 — group stage + knockout bracket |
| [`premier-league`](https://github.com/ismayc/premier-league) | [site](https://ismayc.github.io/premier-league/) | Points table, 34 seasons of history; ~270 tests at 100% coverage |
| [`wnba-schedule`](https://github.com/ismayc/wnba-schedule) | [site](https://ismayc.github.io/wnba-schedule/) | Series playoff bracket, live alerts, quarter line scores |
| [`nfl-schedule`](https://github.com/ismayc/nfl-schedule) | [site](https://ismayc.github.io/nfl-schedule/) | First framework consumer. Week axis, single-elimination postseason |
| [`nba-schedule`](https://github.com/ismayc/nba-schedule) | [site](https://ismayc.github.io/nba-schedule/) | Conference playoff bracket; the base the March Madness viewers copied |
| [`mens-march-madness`](https://github.com/ismayc/mens-march-madness) | [site](https://ismayc.github.io/mens-march-madness/) | NCAA D-I single-elimination tournament bracket (2026, completed) |
| [`womens-march-madness`](https://github.com/ismayc/womens-march-madness) | [site](https://ismayc.github.io/womens-march-madness/) | Same tournament shape as the men's viewer, women's 2026 bracket |
| [`sports-trackers`](https://github.com/ismayc/sports-trackers) (hub) | [site](https://ismayc.github.io/sports-trackers/) | The family page — which viewers have games today, with deep links |

The March Madness pair is the newest shape: built from `nba-schedule` with
`world-cup-viewer`'s knockout bracket grafted in, walking the scoreboard's
`seasontype=3` feed and asserting the 67-game tournament total.

---

## The idea

Every one of these apps is the same app:

> A **committed snapshot** of a season renders instantly with zero network requests.
> A **live overlay** from the same feed merges over the top. Everything else — standings,
> tables, brackets, stats — is *derived* from that snapshot, so a bad data refresh fails a
> test instead of quietly rendering a wrong table.

The only thing that changes between sports is declared in one file: a **league adapter**.

```
adapters/nba.js   adapters/nfl.js   adapters/epl.js
```

## Why this is viable at all

ESPN serves the **same endpoint shape for every league** — only one path segment changes.
Verified 2026-07-20 across NBA, NFL, WNBA, and EPL. All keyless, all CORS-open, no
backend and no `.env` ever required.

```
site.api.espn.com/apis/site/v2/sports/{espnPath}/teams
site.api.espn.com/apis/site/v2/sports/{espnPath}/scoreboard?dates=…
site.api.espn.com/apis/v2/sports/{espnPath}/standings
```

## What actually differs

Everything below was found by testing four real leagues, not by guessing:

| Axis | Values | Leagues |
|---|---|---|
| **Standings model** | `winloss` / `winlosstie` / `points` | NBA·WNBA / NFL / EPL |
| **Season fetch** | `team-schedule` / `calendar-walk` | US sports / **soccer** |
| **Time axis** | `date` / `week` | most / **NFL** |
| **Postseason** | `series` / `single` / `none` | NBA·WNBA / NFL / EPL |
| **Scoring frequency** | `high` / `low` | basketball·NFL / soccer |
| **Week starts** | Sunday / Monday | US / football |
| **Locale** | `en-US` 12h / `en-GB` 24h | US / UK |

Two of those are load-bearing surprises worth calling out:

- **Soccer has no per-team schedule endpoint.** `teams/{abbr}/schedule` returns **HTTP
  400** for `soccer/*` regardless of params. The scoreboard's published `calendar` must be
  walked in date windows instead — and because the scoreboard silently caps at ~50 events,
  the caller *must* assert the expected fixture total afterwards. A short read looks
  exactly like a quiet season.
- **No league's teams feed carries conference or division.** True for NBA, NFL, and WNBA.
  It has to be declared — so `scripts/gen-adapter.mjs` pulls it from the *standings* tree
  rather than trusting a hand-typed list.

## Layout

```
adapters/
  schema.js          the adapter contract + validateAdapter() (fails loudly at startup)
  nba.js nfl.js epl.js   generated from live ESPN data
core/
  utils/standings.js all three standings models, competition ranking, tiebreakers
  utils/time.js      createTimeUtils(adapter) — locale, week start, day bucketing, countdown
  utils/urlState.js  query-string state, only non-defaults written
  utils/ics.js       RFC 5545 with correct 75-OCTET folding
  utils/alerts.js    notable-moment detection for high-scoring sports
  context/follow.jsx starred teams, with an inert fallback so components render bare
  hooks/useModalA11y.js  escape, focus trap, focus restore
  components/Modal.jsx   the dialog shell every build hand-rolled, extracted once
  components/TeamLogo.jsx  dual light/dark img, CSS picks — no flicker on theme change
scripts/
  lib/espn.mjs       shared fetch layer — both season strategies, event normaliser
  gen-adapter.mjs    scaffold an adapter with REAL group data
templates/           ci.yml, node-guard.yml, refresh-data.yml, netlify.toml, vite.config.js
test/smoke.mjs       proves one engine serves all three models against the live API
test/time.mjs        offline: locale + week start really do come from the adapter
docs/PLAYBOOK.md     ← the valuable part
```

## Starting a new league

**See [`docs/NEW-VIEWER.md`](docs/NEW-VIEWER.md)** — the step-by-step procedure the shipped
apps actually follow: copy the closest-shaped sibling, swap the ESPN path in the few files
that hardcode it, regenerate the committed data, adapt the one derivation that differs, and
re-skin the identity. `the-mens-march-madness` is the worked example for the
single-elimination-tournament shape.

The `adapters/` + `gen-adapter.mjs` path below is a partially-adopted refactor; the deployed
apps hardcode their league instead. When the two disagree, follow `docs/NEW-VIEWER.md`.

```bash
node scripts/gen-adapter.mjs --league nba --path basketball/nba --season 2026
```

Then fill in the `TODO` fields it leaves (standings model, time axis, postseason,
approximate game count), and check it against reality:

```bash
node test/smoke.mjs
```

The single most important validation, before building any UI: **derive standings from the
committed results and diff them against ESPN's own standings endpoint.** If wins, losses,
home/road splits, last-10, and streak match for every team, the exclusions are right. That
check is what caught both the Commissioner's Cup and the duplicated-postponed-game traps
in the WNBA build.

## Status

Extracted and verified: the adapter contract, the standings engine (all three models), the
shared fetch layer (both strategies), the adapter-driven time utils
(`createTimeUtils` — locale, hour cycle, week start; proven offline by `test/time.mjs`),
the shared `<Modal>`, the CI/refresh/Netlify templates, and the primitives copied
verbatim from `the-wnba-schedule`.

Not yet extracted — still living in the sibling repos:

- the view components themselves (Schedule / Week / Standings / Stats / Bracket) — the
  bulk of the remaining work
- adoption: the shipped apps still hand-roll their modals and hardcode their locale;
  pointing them at `core/` is per-app work tracked in `docs/STATE.md`
