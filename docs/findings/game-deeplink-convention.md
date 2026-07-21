# The family's game deep-link convention

_Established 2026-07-21, wiring the hub's game rows to open the exact game in each viewer._

## The convention

All six deployed viewers (wnba, nba, nfl, both march-madness, premier-league) read
**`?game=<espn event id>`** and open straight onto that game's detail modal.

- **One-shot**: the param is read once at mount and never written back — the app's first
  URL write returns the address bar to plain shareable filter state. An id the committed
  season doesn't hold is silently ignored.
- The id space is ESPN's event id, which the hub's live scoreboard feed and every app's
  committed snapshot share — hub → app linking needs zero id mapping.
- The hub links every game row as `?game=<id>&team=<abbr>`: `team` is the graceful
  fallback when an app's snapshot predates the fixture (the starred side wins when one
  team is followed, else the home side).

## Two traps this surfaced

1. **`?team=` is SINGULAR everywhere.** The hub's My Teams section originally deep-linked
   with `?teams=A,B` (plural) — a param no viewer's `urlState.js` reads, so the promised
   pre-filter silently did nothing. When adding hub links, check the viewers' actual
   `readState()`, not comments describing it.

2. **Growing `readState()` breaks three tests per fork.** `test/urlstate.test.js` in
   wnba/nba/nfl/mm×2 deep-equals the whole state object ("falls back to defaults",
   "reads every supported key", "round-trips"). Adding the `game` key bit twice in one
   day — NFL caught locally, WNBA caught red on CI because only the edited test file had
   been run locally. Hence the standing rule: run every affected repo's FULL local gate
   before any push; CI confirms, never discovers.

## Evidence

- Viewer-side commit: "Open a ?game= deep link straight onto that game's detail" (all six
  repos, 2026-07-21); hub-side: "Game rows deep-link straight into the game, not just the app".
- End-to-end verified in a browser: `wnba-schedule/?game=401857072&team=NY` opened the
  Liberty–Wings detail directly, with the one-shot param already dropped from the URL.
