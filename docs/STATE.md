# State — 2026-07-20

Where the extraction stands, what is known to be wrong, and what to do next.

---

## Known wrong — fix these first

**The generated adapters have placeholder values that are incorrect.**
`scripts/gen-adapter.mjs` writes `standingsModel: 'winloss'` as a scaffold default and
marks it `// TODO review`. `validateAdapter()` does *not* catch it, because `winloss` is
structurally valid — it is just the wrong answer for two of the three leagues.

| File | Field | Currently | Should be |
|---|---|---|---|
| `adapters/nfl.js` | `standingsModel` | `winloss` | **`winlosstie`** |
| `adapters/nfl.js` | `timeAxis` | `date` | **`week`** |
| `adapters/nfl.js` | `postseason` | `none` | **`single`** |
| `adapters/nfl.js` | `approxGames` | `32 * 0` | **272** |
| `adapters/epl.js` | `standingsModel` | `winloss` | **`points`** |
| `adapters/epl.js` | `tiebreakers` | default | **`['goalDiff','goalsFor']`** — the PL has *never* used head-to-head |
| `adapters/epl.js` | `scoringFrequency` | `high` | **`low`** |
| `adapters/epl.js` | `approxGames` | `20 * 0` | **380** |
| `adapters/epl.js` | `seasonStrategy` | absent | **`calendar-walk`** (see below) |
| `adapters/nba.js` | `postseason` | `none` | **`series`** + `seriesLength` |
| `adapters/nba.js` | `approxGames` | `30 * 0` | **1230** |
| all | `groups` | key→key | human labels (`E` → `Eastern Conference`) |

`adapters/epl.js` also has one "group" (`2026-2027`) because soccer's standings tree nests
by season, not conference. EPL should be `groupBy: 'none'`.

**Worth fixing in the generator, not just the files** — otherwise the next league repeats
it. Options: make the TODO fields `null` so `validateAdapter` rejects them, or infer
defaults from `espnPath` (`soccer/*` → points + calendar-walk + low frequency).

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
   `~/repos/the-wnba-schedule` has `npm run verify:live` for exactly this; run it during a
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

## Next, roughly in order

1. **Fix the adapters and the generator** (above).
2. **Lift locale and week-start out of `core/utils/time.js`.** It is a verbatim WNBA copy
   and still hard-codes `en-US`, 12-hour, Sunday-start. Premier League needs `en-GB`,
   24-hour, **Monday**-start. Both prior builds hard-coded their own — this is the single
   most-copied piece of wrongness across the family.
3. **Extract a shared `<Modal>`.** All three builds hand-roll the shell; `premier-league`
   does it three times. The a11y *hook* was extracted, the *component* never was.
4. **Extract the view components** — Schedule, Week, Standings/Table, Stats — as
   adapter-driven. This is the bulk of the remaining work.
5. **Templates**: `ci.yml` (test + Pages + Netlify + the `scripts-runtime` guard),
   `refresh-data.yml` (fetch → test → **PR, not push**), `netlify.toml`, `vite.config.js`.
   Copy from `the-wnba-schedule`; it has the most recent fixes, including the job-level
   `env` gate.
6. **Decide the packaging story.** Currently a reference repo you copy from. A real
   `npm create` generator is the eventual goal but is not needed to build NBA next.

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
