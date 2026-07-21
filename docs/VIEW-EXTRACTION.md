# Scoping the view-component extraction

Surveyed 2026-07-21 across all seven apps (every view component read, not just named).
This is the plan for STATE.md's remaining big item. Short version: **extract
ScheduleView first** — it is already byte-identical in four apps and two comment-lines
off in a fifth — and do NOT attempt a shared Standings or Bracket yet; the same-named
components have quietly diverged in *behavior*, not style.

## What each app ships

| App | Views (App.jsx `useState` string) |
|---|---|
| world-cup-viewer | schedule (inline), week, groups (inline), scenarios, outlook, bracket, radial, stats |
| premier-league | fixtures, week, table, stats, history |
| the-wnba-schedule | schedule, week, standings, playoffs, radial, stats |
| the-nba-schedule | schedule, week, standings, playoffs, radial, stats |
| the-nfl-schedule | schedule, week, standings, playoffs, stats |
| the-mens/womens-march-madness | schedule, bracket |

Lineage matters: NBA is the base; NFL forked it and added `src/config/league.js` —
**the only app that already has the adapter abstraction**, and the template for how
views should consume one. WNBA is the newest full build; the March Madness pair is a
stripped two-view fork of NBA with a rewritten regional bracket.

## Similarity, view by view

- **ScheduleView — extract this one.** Byte-identical across NBA/WNBA/both MMs; NFL
  differs by two comment lines. Same props (`{games, tz, hideScores, showPast, onOpen}`),
  same classnames, same day-bucketing. League surface ≈ two adapter touches: the game
  time field and the count noun. ~5×59 LOC of pure duplication, and extracting it forces
  the shared `game` shape + time utils that every later view rides on. PL's FixturesView
  and WCV's inline schedule adopt in a second pass by mapping `ko` → `tip`.
- **WeekView — runner-up, weekday-grid variant only.** NBA↔WNBA near-identical; WNBA's
  All-Star handling is an additive branch that folds into an adapter predicate. NFL's is
  a DIFFERENT component (week-number axis, controlled `week`/`onWeekChange`) — keep it
  as its own `WeekByNumber`, don't force-unify. PL (Mon–Sun fixtures grid) and WCV
  (Sunday-keyed) join only after the `weekStart` lift is adopted.
- **Standings/Table — do not unify yet.** Three genuinely different models wearing the
  same props: NBA per-conference with play-in cutlines, WNBA league-wide 1–8 with a
  League/Conference toggle (different utils API: `playoffRace` vs `PLAYIN_SEEDS`), NFL
  division-based W-L-T with seven seeds. PL is a points table, WCV is group tables. A
  naive shared Standings silently breaks someone's playoff picture.
- **Stats — not yet.** The `{onPickTeam, onPickPlayer}` shell is shared across
  NBA/WNBA/NFL, but the playoff-status column tracks each app's standings model, and PL
  + WCV both FETCH live athlete data inside the component (see landmines).
- **Bracket — last.** Every app's bracket is effectively a different component (best-of
  series tree / single-elim reseed / regional columns / knockout+radial). Reuse is
  per-shape at best.

## Order of work

1. **ScheduleView** into `core/components/`, adapter-fed (`gameNoun`, time field);
   first adopter: the next new viewer or the-nba-schedule (its copy is canonical).
2. **WeekView (weekday grid)** with the All-Star branch behind an adapter predicate;
   NBA and WNBA adopt.
3. **GameCard/GameDetail shape audit** — the schedule extraction will surface the
   normalized `game` object; freeze it in `adapters/schema.js` while it's fresh.
4. Standings only after a `standingsModel`-keyed split: three small components sharing
   chrome, not one component with three souls.

## Landmines (verified file:line)

- WNBA StandingsView rebuilt seeding league-wide + mode toggle
  (`the-wnba-schedule/src/components/StandingsView.jsx:129,139-150`) vs NBA
  per-conference play-in (`the-nba-schedule/src/components/StandingsView.jsx:88-138`).
- Same divergence in StatsView status logic (NBA `StatsView.jsx:210-224`, WNBA
  `StatsView.jsx:215-223`).
- WNBA All-Star special-casing is sprinkled: `WeekView.jsx:38-58`,
  `GameDetail.jsx:161,174,200-206,383-393`. An extracted Week/Detail needs a seam for
  non-franchise entrants.
- Views that reach into live-fetch code (breaks committed-data purity; put the fetch
  behind a prop/hook before extracting): `premier-league/src/components/StatsView.jsx:6`
  (`services/athlete`), `world-cup-viewer/src/components/StatsView.jsx:15`
  (`services/espnStats`), `premier-league/src/components/FixturesView.jsx:6`
  (`context/services`).
- Hardcoded league identity inside views (move to adapter on contact):
  NBA `StandingsView.jsx:155`, NFL `Bracket.jsx:175` ("Super Bowl"), NBA
  `RadialBracket.jsx:174` ("NBA Finals"), MM `Bracket.jsx:158` ("Final Four"), WCV
  `Standings.jsx:291,335,531`.
- Context coupling is uneven: NBA/WNBA/NFL views import only `context/follow`; MM
  Bracket is props-only; WCV views also want `context/path` + `context/detail`. The
  shared view API must take follow/detail/path as optional injections, not hard imports.
