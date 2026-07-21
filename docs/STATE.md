# State — 2026-07-21

Where the extraction stands, what is known to be wrong, and what to do next.

---

## 2026-07-21 (later) — locale lift, shared Modal, deploy templates

Three of the five "Next" items from the reorg entry, done in order:

- **Locale + week-start lifted into the adapter.** `adapters/schema.js` gains `locale`
  (BCP-47; the hour cycle comes free — en-US → "7:00 PM", en-GB → "19:00", so there is
  no separate 12/24h field) and `weekStart` (0 Sunday / 1 Monday), both validated,
  defaulting to en-US/Sunday. `core/utils/time.js` is now a factory —
  `createTimeUtils(adapter)` — with the old bare exports kept as en-US defaults for
  code copied from earlier builds. It also gains the previously never-extracted
  `startOfWeek`, adapted from premier-league's Monday-based version. `adapters/epl.js`
  declares `en-GB` + Monday; `gen-adapter.mjs` emits `weekStart: 1` for all soccer and
  `locale: 'en-GB'` only for `soccer/eng.*` (locale is a market fact, not a sport
  fact — an MLS build would be en-US). Proven offline by `node test/time.mjs`.
- **Shared `<Modal>` extracted** to `core/components/Modal.jsx` — the WNBA shell
  (backdrop mousedown-to-close, role=dialog + aria-modal, `useModalA11y`, the ✕),
  parameterized by `label` / `className` / `onClose`. Adoption in the sibling apps is
  per-app work; premier-league's three hand-rolled shells are the first candidates.
- **Templates landed** in `templates/`: `ci.yml` + `node-guard.yml` (verbatim from
  the-wnba-schedule, incl. the job-level env gate), `refresh-data.yml` (league-specific
  bits — crons, fetch script, diff paths — marked TODO), `netlify.toml`, and
  `vite.config.js` from the-nfl-schedule (the one that enforces 100% coverage with
  `all: true` + thresholds, per the ship checklist).

Same day, in the hub: a "Next two weeks" day-grouped breakdown of every upcoming game
across the visible viewers (respects the sports picker + services filter, rows deep-link
into each viewer), and the 14-day look-ahead now fetches as two ~week ranges so a dense
league's middle days don't get thinned (see docs/findings/espn-scoreboard-range-lookahead.md).

---

## 2026-07-21 — reorg, two new viewers, a hub, and going public

- **Reorg.** All family repos now live under `~/repos/sports-trackers/` (a plain container
  folder, not a git repo). Each app is still its own independent GitHub repo; deploys are
  unaffected (they build from remotes, not local paths).
- **Two new viewers** — `the-mens-march-madness` and `the-womens-march-madness`, NCAA D-I
  tournament brackets built from `the-nba-schedule` with `world-cup-viewer`'s knockout
  bracket grafted in. New single-elimination shape: `scripts/fetch-bracket.mjs` walks the
  scoreboard `seasontype=3` and filters to the NCAA championship (the NIT/Crown/WBIT share the
  feed), asserting the 67-game total; `src/utils/bracket.js` reconstructs four regions → Final
  Four from each game's region/round/seed. Committed data is the completed **2026** tournament.
- **`hub/`** — a new family page (its own repo `ismayc/sports-trackers`) showing which viewers
  have games today, with season-phase badges, an install shelf, and deep links.
- **Going public** — this repo becomes public, with a new [`docs/NEW-VIEWER.md`](NEW-VIEWER.md)
  documenting the real copy-a-sibling procedure (the deployed apps hardcode their league; the
  `adapters/` refactor is only partially adopted — the doc reconciles the two).

---

## Fixed 2026-07-20 — the adapters and the generator

**Was:** the three generated adapters carried scaffold placeholders
(`standingsModel: 'winloss'`, `timeAxis: 'date'`, `postseason: 'none'`, `approxGames: N*0`)
that were structurally valid — so `validateAdapter()` passed them — but wrong for two of
the three leagues.

All three adapters are now corrected by hand and load-and-validate clean:

- `adapters/nfl.js` — `winlosstie`, `timeAxis: 'week'`, `postseason: 'single'`,
  `closeMargin: 8`, `approxGames: 272`, conferences given full names.
- `adapters/epl.js` — `points` + `tiebreakers: ['goalDiff','goalsFor']` (the PL has
  *never* used head-to-head), `scoringFrequency: 'low'`, `closeMargin: 1`,
  `approxGames: 380`, `seasonStrategy: 'calendar-walk'`, `groupBy: 'none'` (the bogus
  `2026-2027` pseudo-group is gone), plus soccer vocabulary (match / half / 2 / `v`).
- `adapters/nba.js` — `postseason: 'series'` + `seriesLength`, `playoffSpots: 16`,
  `approxGames: 1230`, conferences given full names.

**Fixed at the source too**, so the next league starts correct rather than correct-looking:

- `adapters/schema.js` now defines `seasonStrategy` (`team-schedule` | `calendar-walk`),
  validates it, and defaults it to `team-schedule`.
- `scripts/gen-adapter.mjs` infers a **sport profile** from `espnPath`
  (`soccer/*` → points + calendar-walk + low + soccer vocab + `groupBy: 'none'`;
  `football/nfl` → winlosstie + week + single; `basketball/*` → winloss + series). Group
  labels now come from the standings node's full `name` (`East` → `Eastern Conference`)
  instead of key→key. `approxGames` is computed exactly for soccer (double round-robin);
  it stays a visible `TODO` for the US leagues, since game count isn't derivable from team
  count there. Unknown sports emit conservative guesses under a loud "confirm EVERY one"
  banner.

Verified by generating throwaway soccer and basketball adapters, confirming output, and
validating — then deleting them. The inline configs in `test/smoke.mjs` already matched
these values, so the adapters and the smoke test now agree.

---

## Verified empirically (2026-07-20, against the live API)

These are measured, not assumed. Re-check if ESPN changes.

1. **One endpoint shape, four leagues.** Only the `{espnPath}` segment changes across
   `basketball/nba`, `football/nfl`, `basketball/wnba`, `soccer/eng.1`. Keyless,
   CORS-open. This is the entire reason the framework is viable.

2. **Soccer has NO per-team schedule endpoint.**
   `site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/BRE/schedule` returns
   **HTTP 400** with *any* combination of `season` / `seasontype` / no params. US leagues
   return it fine. Soccer must use the calendar walk. Found by a crash in `test/smoke.mjs`,
   not by reading docs.

3. **The scoreboard silently caps at ~50 events** regardless of `limit`. Walk in windows
   and **assert the expected total** — a short read is indistinguishable from a quiet
   season. EPL check: `teams × (teams − 1)` = 380. ✅ passing.

4. **No league's teams feed carries conference or division.** Confirmed for NBA, NFL, and
   WNBA. Group membership must come from the standings tree.

5. **Standings columns differ by league**, which is what the three models encode:
   - NBA/WNBA — `wins losses gamesBehind playoffSeed pointsFor pointsAgainst streak`
   - NFL — same **plus `ties`**
   - EPL — `wins ties losses points rank` — no `gamesBehind`, no `playoffSeed`

6. **NFL events carry `week: { number }`** as a first-class field; other leagues don't.
   Week is the primary axis there, not a label.

7. **Live payload shape is still UNVERIFIED.** Every scoreboard response observed while
   building was `pre` or `post` — no game was in progress. The WNBA app's live-overlay
   field mapping (`state === 'in'`, `shortDetail`, `period`, `displayClock`) is *inferred*,
   and its tests mock ESPN using the same inference, so they agree by construction.
   `~/repos/sports-trackers/the-wnba-schedule` has `npm run verify:live` for exactly this; run it during a
   game before trusting the live path in any new build.

### Smoke test output to expect

```
WNBA  winloss     fetched=332  played=193  MIN 20-6   ← matches ESPN's published standings exactly
NFL   winlosstie  fetched=272  played=272  SEA 14-3
EPL   points      fetched=380  played=0    ✅ 380 === teams × (teams−1)
```

---

## Done

- `adapters/schema.js` — the contract, with `validateAdapter()` failing loudly at startup
- `core/utils/standings.js` — all three models, competition ranking (ties share a
  position), deterministic final tiebreak, group splitting
- `scripts/lib/espn.mjs` — shared fetch layer, both season strategies, event normaliser
  that encodes the "completed games only" rule
- `scripts/gen-adapter.mjs` — scaffolds an adapter with real group data from standings
- `core/` primitives copied verbatim from `the-wnba-schedule`: `time`, `urlState`, `ics`,
  `alerts`, `follow`, `useModalA11y`, `TeamLogo`
- `docs/PLAYBOOK.md`, `README.md`, `CLAUDE.md`

## Per-app ship checklist — every viewer, incl. NBA next

Established building `the-nfl-schedule` (the first framework consumer); apply to every app:

- [ ] **100% test coverage, enforced.** Set `coverage: { all: true, thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 } }` in `vite.config.js` so a gap fails CI — not just a badge (PLAYBOOK §8). `premier-league` is the exemplar (~270 tests); `the-wnba-schedule` is the render-test pattern to copy (`test/*.test.jsx` + real-data fixtures + a completed-postseason bracket fixture).
- [ ] **Full README with badges**, matching `the-wnba-schedule/README.md`: CI + coverage + License shields, live links, a **Views table**, Data/feed-quirks, Testing approach, and Deploy sections.
- [ ] **A social share image** (`public/og-image.png`, 1200×630) with `og:image`/`twitter:image` at an absolute canonical URL — authored as on-brand HTML and rendered to PNG (see `the-nfl-schedule/scripts/og-image.html` + `make-og-image.md`). Not optional.
- [ ] **App icons** — `public/{icon.svg, apple-touch-icon.png (180), icon-192.png, icon-512.png}` from the sport's **Google Noto Emoji** ball on the app's dark background (NOT the league logo — that's a trademark and impersonates an official app). Wire `<link rel="apple-touch-icon">` + `apple-mobile-web-app-title` in `index.html` and the PNGs in the manifest. Full recipe (+ the ImageMagick gotchas) in **`docs/ICONS.md`**.
- [ ] Don't reference the private `sports-viewer-meta` repo from any public app README/docs.

## Next, roughly in order

1. **Extract the view components** — Schedule, Week, Standings/Table, Stats — as
   adapter-driven. This is the bulk of the remaining work.
2. **Adopt the extractions in the siblings** — point the apps at the shared `<Modal>`
   (premier-league hand-rolls it three times) and at `createTimeUtils(adapter)`.
3. **Decide the packaging story.** Currently a reference repo you copy from. A real
   `npm create` generator is the eventual goal but is not needed to build NBA next.

(Items formerly 1, 2, and 4 — the locale/week-start lift, the shared `<Modal>`, and the
templates — landed 2026-07-21; see the entry at the top.)

## Debts recorded, not inherited

From the sibling repos — do *not* copy these across:

- `premier-league` commits a **333 KB `players.js`** parsed on every page load, with every
  season and category in the main bundle. Chunk per season, fetch on demand.
- `premier-league` has **no error surface at all** — every failure is `catch {}` with no
  `aria-live`. Carry the WNBA toast system instead.
- `premier-league` sets `fileParallelism: false` as a Vitest coverage workaround (~1 min
  per run). Documented there, but re-check before baking into a shared config.
- League identity is scattered across services, scripts, storage prefixes, `.ics` UID
  domains and filenames in both older builds. It all belongs in the adapter.
