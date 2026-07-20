# Playbook

What three builds — `world-cup-viewer`, `premier-league`, `the-wnba-schedule` — taught,
written down so build four (NBA) and five (NFL) don't relearn it.

The code in `core/` is the cheap part. This file is the expensive part.

---

## 1. The architecture that keeps working

**Committed snapshot + live overlay, sharing one id space.**

A build-time script writes the whole season into `src/data/*.js`. The app renders it with
**zero network requests**. At runtime, the same ESPN scoreboard endpoint is polled and
merged over the top. Because both paths hit the same feed, event ids join cleanly and the
merge is ~12 lines.

Three consequences worth stating plainly:

- First paint is instant and works offline.
- The app is *stale, not broken* when the feed is down — every fetch failure is a silent
  catch.
- Standings, tables, brackets, and stats are all **derived** from the committed results.
  A bad refresh therefore fails a test rather than quietly rendering a wrong table.

**The rule that makes the merge trivially correct:**

> A score is written to the snapshot only for a **completed** game. An in-progress score
> is transient and belongs to the overlay, never the committed data.

**And the rule that keeps the overlay safe:**

> The merge copies only defined values. A feed that omits a field can never blank a field
> the snapshot already holds.

Get those two wrong and you get flickering scores and phantom 0–0 results.

---

## 2. ESPN is one API with a swappable path

Verified 2026-07-20 across four leagues. Only the `sport/league` segment changes:

```
https://site.api.espn.com/apis/site/v2/sports/{espnPath}/teams
https://site.api.espn.com/apis/site/v2/sports/{espnPath}/teams/{abbr}/schedule?season=&seasontype=
https://site.api.espn.com/apis/site/v2/sports/{espnPath}/scoreboard?dates=YYYYMMDD[-YYYYMMDD]
https://site.api.espn.com/apis/v2/sports/{espnPath}/standings?season=
https://site.web.api.espn.com/apis/common/v3/sports/{espnPath}/statistics/byathlete?season=&seasontype=
```

| League | `espnPath` | Teams |
|---|---|---|
| NBA | `basketball/nba` | 30 |
| NFL | `football/nfl` | 32 |
| WNBA | `basketball/wnba` | 15 |
| EPL | `soccer/eng.1` | 20 |

All keyless, all CORS-open. **No API key, no backend, no `.env` has ever been needed.**

### Feed traps, each of which cost real debugging time

1. **The teams feed carries no conference or division.** True for NBA, NFL, and WNBA
   alike. It has to be declared by hand — so `scripts/gen-adapter.mjs` pulls it from the
   *standings* tree instead, because a hand-typed 30-team list is exactly the thing that
   is silently wrong for one team all season.
2. **The scoreboard silently caps at ~50 events** regardless of `limit`. Walk the
   published `calendar` in windows, and **assert the expected total before writing**
   (`premier-league` asserts exactly `teams × (teams − 1)` = 380).
3. **Two different broadcast shapes.** The team-schedule feed uses `media.shortName`; the
   scoreboard uses `names[]`. Accept both.
4. **Postponed games appear twice** — the original slot *and* the makeup fixture. Flag the
   dead one or it double-counts in standings.
5. **Non-league games hide in the league feed.** The WNBA Commissioner's Cup Championship
   sits in the schedule feed but does not count toward standings. Expect one of these per
   league and reclassify it.
6. **Line scores and per-game leaders exist only on the scoreboard**, not the team
   schedule. The scoreboard accepts a **date range**, so a month per request covers a
   season in ~6 calls rather than ~180.
7. **`$ref`-linked athletes.** The core-API leaders endpoint returns athletes as links
   (~75 extra fetches). The `statistics/byathlete` endpoint inlines name, team, and
   position in **one** request. Use that.

### The verification that matters

After handling 1–7, **derive the standings from the committed results and diff them
against ESPN's own standings endpoint.** If W-L, home/road splits, last-10, and streak
all match for every team, the exclusions are right. If they don't, one of the traps above
is still biting. This check found traps 4 and 5.

---

## 3. Scoring frequency changes the data model

The single biggest axis on which sports diverge — bigger than the standings format.

| | Low frequency (soccer) | High frequency (basketball, NFL) |
|---|---|---|
| Events | ~2.7 goals/match — **enumerate them** | ~65 scores/game, ~20k/season — **don't** |
| Leaderboards | derived from the event list | pre-aggregated season stat lines |
| Timeline | goal-by-goal | **quarter line score** |
| Alerts | a goal toast is meaningful | one per basket = ~65/game of noise |
| Live label | scoreline is safe | show the **period**, never a running clock |

That last row is a correctness point, not taste. A soccer app can show a goal and stay
right for ten minutes. A basketball score is stale within seconds, so rendering ESPN's
`"Q3 4:21"` behind a 30-second poll implies precision that doesn't exist. Show `Q3`.

**For high-frequency sports, alert on notable moments instead:** tipoff, lead change, a
one-possession final period, and the final. All derivable by diffing two poll snapshots —
no play-by-play feed needed. Fire the close-game alert *once on entering that state*, not
every poll while it holds, and collapse a buzzer-beater that flips the lead **and** ends
the game into one event rather than three.

---

## 4. Standings: three models cover five leagues

```
winloss     W-L, ranked by win%, gamesBehind          NBA, WNBA
winlosstie  W-L-T, a tie is half a win                NFL
points      W-D-L, 3/1/0, ranked pts → GD → GF        EPL, World Cup groups
```

**Ties share a position.** Competition ranking (1, 2, 2, 4) — in the table, and in every
leaderboard. Implement it once:

```js
let pos = 0, prev = null
rows.forEach((r, i) => {
  const key = keyOf(r)
  if (key !== prev) { pos = i + 1; prev = key }
  r.pos = pos
})
```

**Always end with a deterministic tiebreak** (`abbr.localeCompare`) so the order doesn't
shuffle between renders.

**Seeding is not universal.** WNBA seeds 1–8 **league-wide**; NBA and NFL seed per
conference. Getting this wrong produces a plausible-looking, entirely wrong bracket.

**Don't invent precision.** The public feeds expose no possession counts and no xG.
Anything called an "efficiency rating" or "attacking rating" would be fabricated. Name
things literally: *points per game*, *goal difference*, *scoring margin*.

---

## 5. Time is the most-often-wrong code

Every game stores an **absolute UTC instant**. Rendering into a zone is then pure
formatting — no date math, no DST edge cases.

**Bucket by the calendar day the viewer sees**, via `formatToParts` in their zone:

```js
const dayKey = (iso, tz) => /* YYYY-MM-DD from formatToParts(tz) */
```

A 10pm Pacific tip is *today* out west and *tomorrow* on the east coast. This is the
piece most implementations get wrong.

Other landmines:

- **Week start differs by sport.** Premier League weeks run **Monday**–Sunday; US sports
  run Sunday–Saturday. Parameterise it.
- **Locale differs.** `en-GB` + 24-hour for football; `en-US` + 12-hour for US leagues.
  Both prior builds hard-coded theirs. Parameterise it.
- **Anchor week/day math at UTC noon** so a DST transition can't shift a game into the
  wrong column.
- **Poll a 3-day window** (`[-1, 0, +1]`) with `Promise.allSettled`, so one bad date
  doesn't blank the overlay and a late kickoff still resolves for a viewer a day ahead.
- **Drop past days *whole*, not by tip-off time.** A game that started at 1pm still
  belongs to today at 5pm.

---

## 6. Things that look green but aren't

The recurring failure mode across this whole family of projects: **a signal says fine and
reality differs.** Five real instances, all from one build:

1. **A CI job gated on a missing secret passed while deploying nothing.** Fix: give the
   skip path its own explicit step (`::notice::…skipped`) so a no-op is visibly different
   from a real run.
2. **A step's own `env:` is not in scope for that step's `if:`.** The gate was therefore
   always false and would have skipped forever, even once the secret existed. Declare the
   env at **job** level.
3. **`gh secret set` prompts only on a TTY.** Run non-interactively it reads empty stdin
   and sets an **empty secret**, printing nothing. Treat *no output from a command that
   normally confirms* as a failure signal, and verify the effect, not the exit code.
4. **An enrichment pass mutated the data array after the file was already written** — the
   script cheerfully logged "193 enriched" while the output had none. Check the artifact,
   not the log.
5. **A stylesheet 404'd in a verification harness**, so a "visual check" rendered unstyled
   markup and proved nothing.

The generalisation: **verify the effect, never the report of the effect.**

### Corollaries that earn their keep

- **Mutation-test anything that passed first try.** If tests were written from the same
  assumptions as the code, they agree by construction. Break the source five ways; if no
  test fails, they're decorative. (This caught nothing wrong — which is the point: it
  turned "probably fine" into evidence.)
- **A 100%-covered module can still be wrong about reality.** The WNBA live overlay was
  100% covered by tests whose mocks encoded field mappings *inferred* from completed
  games, because no game was live while it was written. Coverage measures self-consistency,
  not truth. Ship a `verify:live` script that checks the assumptions against a real
  in-progress game.
- **Measure layout, don't eyeball it.** `scrollWidth - clientWidth` across every view ×
  theme × viewport found horizontal overflow that screenshots had not made obvious.

---

## 7. Data-integrity tests beat unit tests here

Both mature builds converged on the same idea: **assert arithmetic invariants over the
committed dataset**, and run them in CI so a bad refresh fails rather than ships.

```js
// premier-league: every historical season must be internally consistent
expect(sum('played')).toBe(season.matches * 2)
expect(sum('gd')).toBe(0)
expect(sum('gf')).toBe(sum('ga'))
expect(sum('points')).toBe((matches - draws) * 3 + draws * 2)

// the-wnba-schedule: every quarter line score must sum to its final score
expect([sum(line.home), sum(line.away)]).toEqual(game.score)
```

Prefer **real data as the fixture**. Test the bracket against a *completed* postseason
(the 2025 WNBA playoffs — 24 games, 7 series, a known winner). Real data contains the edge
cases you wouldn't invent: it caught two bracket bugs a synthetic fixture would have
sailed past, because a synthetic fixture reproduces your own assumptions.

But **put format invariants on synthetic data**. "Seeding ignores conference" tested
against live standings is hostage to this week's results; build a fixture where one
conference sweeps.

---

## 8. Ship discipline

- **`scripts/` imports Node built-ins only**, so the refresh job runs on a bare checkout
  with no `npm ci`. Enforce it with a CI grep job — otherwise it breaks at 6am, not in
  review. (Shared **relative** imports are fine; both prior builds wrongly duplicated
  `getJson`/`arg` across every script. `scripts/lib/` satisfies the guard.)
- **The refresh workflow opens a PR, not a push**, and runs the suite against the newly
  fetched data first.
- **`base: './'`** so one `dist/` serves a domain root and a subpath.
- **Mirror logos locally** through ESPN's combiner at 160px (~8KB vs ~40KB), render both
  light and dark `<img>`, and let CSS pick — no flicker, no re-request on theme change.
- **Coverage**: `premier-league` enforces `thresholds: 100`; `the-wnba-schedule` publishes
  a self-hosted shields endpoint. Do both — the threshold is the gate, the badge is the
  signal.

---

## 9. Design rules that survived contact

- **The accent colour never encodes data.** Keep UI-chrome tokens and data-mark tokens in
  separate families, so a coloured mark is never mistaken for a control. Feeding the WNBA
  accent and its diverging red to a palette validator showed them 6.4 apart in normal
  vision — under the 15 floor.
- **Status is icon + word, never colour alone.**
- **Validate the palette against your own surfaces**, not the reference ones.
- **Copy differs more than logic.** *fixture/match* vs *game*, *v* vs *@*, *club* vs
  *team*. Getting this wrong makes an app feel foreign; it belongs in the adapter.
- **Keep comments that record fixed bugs.** A button may not contain a button. React
  renders `0`, so use `x?.length > 0` not `x &&`. Don't memoise a "next kickoff" lookup on
  `[fixtures]` or it pins to a passed kickoff. These are worth more than the code.

---

## 10. Known debts — fix in the framework, don't inherit

From the two mature builds, the things worth *not* copying:

1. **Three hand-rolled modal shells** (`premier-league`). The a11y *hook* was extracted;
   the *component* wasn't. `core/components/Modal.jsx` is the missing primitive.
2. **League identity scattered** across services, scripts, storage prefixes, `.ics` UID
   domain, filenames, and calendar names. All of it belongs in the adapter.
3. **`VIEWS` declared twice** — in `App.jsx` and in `urlState.js`. Single source.
4. **A 333KB committed `players.js`** parsed on every page load, with every season and
   category in the main bundle. Chunk per season and fetch on demand.
5. **No error surface** in `premier-league` — every failure is `catch {}` with no
   `aria-live` region. The WNBA toast system is the piece to carry across.
6. **`fileParallelism: false`** as a Vitest coverage workaround. Documented, but re-check
   before baking it into a shared config.
