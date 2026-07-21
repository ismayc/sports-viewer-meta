# Building a new viewer

How to add another sport to the family. This is the **actual** procedure the shipped apps
follow — copy the nearest sibling and swap what differs — not the aspirational
`gen-adapter.mjs` flow the README sketches. (The apps hardcode their ESPN path as URL
constants in a handful of files rather than reading a generated adapter; the adapter system
in `adapters/` is a partially-adopted refactor. When the two disagree, this document wins,
because it describes code that is actually deployed.)

Read [`PLAYBOOK.md`](PLAYBOOK.md) first — it is the expensive part. This is just the wiring.

---

## 0. Decide two things before touching code

**(a) Does ESPN carry the sport, at one swappable path?** Everything downstream depends on
this. Check:

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/{espnPath}/scoreboard?dates=YYYYMMDD" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('events',[])),'events')"
```

`{espnPath}` is `sport/league`, e.g. `basketball/nba`, `football/nfl`, `soccer/eng.1`,
`basketball/mens-college-basketball`, `hockey/nhl`, `baseball/mlb`. Keyless and CORS-open, or
it is the wrong feed — the family has **no backend and no `.env`, ever**.

**(b) What SHAPE is the competition?** This picks your base app and your data model:

| Shape | Standings/postseason | Base to copy | Real example |
|---|---|---|---|
| League + series playoffs | win/loss table → best-of-7 bracket | `the-nba-schedule` | NBA, WNBA |
| League + single-elim playoffs | win/loss/tie table → single-game bracket | `the-nfl-schedule` | NFL |
| League table, no playoff | points table (3/1/0) | `premier-league` | EPL |
| Group stage → knockout | groups → single-leg knockout | `world-cup-viewer` | World Cup |
| **Pure single-elim tournament** | **no table; one bracket** | **`the-mens-march-madness`** | **March Madness** |

Copy the **closest** sibling wholesale — you inherit its live overlay, calendar, alerts,
theming, CI, and tests, and then change only what the new sport needs.

---

## 1. Copy a sibling

```bash
cd ~/repos/sports-trackers
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude coverage \
  the-mens-march-madness/ the-new-viewer/
cd the-new-viewer && rm -rf .netlify
```

The copy has **no `.git`** — it becomes its own independent GitHub repo later (`git init`,
new remote under `ismayc/`). It keeps the sibling's history in neither place; that is intended.

## 2. Swap the ESPN path (the ~4 hardcoded spots)

Grep for the old league and change every hit to your `{espnPath}`:

```bash
grep -rn "basketball/mens-college-basketball" scripts src | grep -v src/data
```

They live in: `scripts/fetch-*.mjs`, `scripts/check-*.mjs`, `src/services/espn.js` (the live
overlay), and `src/services/summary.js` (the game-detail box score). Also fix the OT math if
regulation differs — basketball is 2 halves for college (`period > 2`) but 4 quarters for the
NBA (`period > 4`); the live overlay and the fetch script both encode it.

## 3. Regenerate the committed data

The build script is the heart of the app. For a **league**, it fetches one team-schedule per
team (`fetch-schedule.mjs`). For a **tournament**, it walks the scoreboard across the event
window and filters (`fetch-bracket.mjs`). Either way it must:

- **Assert the expected total before writing** (PLAYBOOK §2 trap 2 — the scoreboard silently
  caps at ~50 events, and a short read is indistinguishable from a quiet season). A completed
  68-team bracket is always 67 games; the men's script `throw`s if it sees another count.
- **Filter out interlopers** (PLAYBOOK §2 trap 5 — non-league games hide in the feed). The
  college `seasontype=3` window also carries the NIT and the Crown/WBIT; the March Madness
  builder keeps only games whose `notes[0].headline` starts with
  `"NCAA (Men's|Women's) Basketball Championship"`.
- Write `src/data/*.js` with a `// GENERATED … do not edit` banner, and mirror team logos into
  `public/logos/` through ESPN's 160px combiner (~8KB each) so the app ships zero external
  image requests.

```bash
npm run fetch:bracket   # or fetch:schedule — regenerates src/data + public/logos
```

**Then validate against reality** before building any UI. The single most valuable check:
derive the app's structure from the committed data and diff it against ESPN's own view. For a
league, that's the standings endpoint (PLAYBOOK §2). For a bracket, it's the champion and each
region winner:

```bash
node -e "import('./src/data/schedule.js').then(async d => {
  const { buildBracket } = await import('./src/utils/bracket.js')
  const b = buildBracket(d.GAMES)
  console.log('champion', b.champion, 'projected', b.projected,
    b.regions.map(r => r.name+'='+r.champion))
})"
```

If it reconstructs the known result with **zero projected slots**, the parsing is right.

## 4. Adapt the data model + derivations

This is the only genuinely new code. Everything that renders is *derived* from the committed
snapshot, so the derivation utility is where a sport's structure lives:

- `src/utils/standings.js` — the table (win/loss, win/loss/tie, or points). Delete if the sport
  has no table (a pure tournament doesn't).
- `src/utils/bracket.js` — the postseason. The March Madness version reconstructs four regional
  sub-brackets → Final Four from each game's `region`/`round`/seed pair, slotting the Round of
  64 by the fixed seed order (1·16 / 8·9 / 5·12 / 4·13 / …) and locating later rounds by lineage
  (a game is the child of the two prior slots whose winners it joins). Keep it **DOM-free** so it
  can be unit-tested against real data.
- The committed game record carries whatever the views need: `home`/`away`, `score`, `tip`
  (absolute UTC instant — render into a zone, never store a local time), plus sport-specific
  fields (`round`/`region`/seeds for a bracket, `week` for the NFL, `line`/`stars` for a
  box score).

## 5. Trim the views to the sport

The views are `useState('view')` strings in `App.jsx` and a matching `VALID_VIEWS` in
`src/utils/urlState.js` (keep them in sync — this is a known duplication). Delete the component
files for views the sport doesn't have and remove their imports. March Madness dropped Week,
Standings, Radial, and season Stats, keeping **Bracket** (default) + **Schedule**; a
tournament has no season table and no league-wide season leaderboard worth showing.

If you drop season stats, note that `GameDetail`/`TeamPanel` may still import `utils/stats.js`
→ `data/leaders.js`; ship `leaders.js` as an empty `export const PLAYERS = []` rather than stale
data from the copied sibling.

## 6. Re-skin the identity

League identity is scattered (PLAYBOOK §10 debt #2) — change all of it:

- **Storage namespace**: every `localStorage` key prefix (`nba:` → `mmm:`), in `App.jsx` and the
  pre-paint theme script in `index.html`.
- **Copy**: title, tagline, footer disclaimer (name the right league and its trademark),
  "match/game", "@"/"v", locale + 12h/24h (in `utils/time.js`).
- **URLs**: canonical + OG/Twitter (`index.html`), the Netlify calendar host (`CalendarModal.jsx`
  `PROD`), the `.ics` PRODID + UID domain (`utils/ics.js`), the source-repo link (`App.jsx`
  footer), and `package.json` `name` + script names.
- **Theme + icon**: give the app its own accent in `src/index.css` (validate contrast — PLAYBOOK
  §9), and a new icon + og-image per [`ICONS.md`](ICONS.md). Two apps covering the same sport must
  differ by mark or ground — the two March Madness apps share one custom hoop+net mark on
  different grounds (men's crimson `#3a0d12`, women's purple `#2d0d4a`) so neither collides with
  the NBA/WNBA basketballs.

## 7. Tests, CI, deploy

- **Tests**: the suite is data-integrity-first (PLAYBOOK §7). Point the bracket/standings test at
  the **real** committed data and assert the known-true facts (2026 champion is Michigan; every
  region has 15 non-projected slots; each Round-of-64 seed pair sums to 17). Delete tests for
  removed features; do not weaken the survivors.
- **CI** (`.github/workflows/`): `ci.yml` (test → coverage badge → build → deploy Pages, Netlify
  gated on its token, a `scripts-runtime` grep that enforces Node-built-ins-only under `scripts/`),
  `node-guard.yml` (the shared `ismayc/gha-guards` reusable workflow), and `refresh-data.yml`
  (cron → regenerate → open a PR; gate the cron to the sport's active months so it isn't a
  year-round no-op — March Madness runs its cron only in March/April).
- **Deploy**: `base: './'` (serves both the Pages subpath and the Netlify root). New GitHub repo
  under `ismayc/`, GitHub Pages from `main`.

## 8. Register it in the hub

Add the viewer to `~/repos/sports-trackers/hub/src/data/viewers.js` (id, name, emoji, `espnPath`,
Pages URL, calendar host, season months). The hub fetches the same scoreboard client-side to show
whether the sport has games today and deep-links into the viewer — so a new viewer appears on the
family page as soon as it is registered.

---

## The checklist

```
[ ] ESPN carries it at one swappable path, keyless + CORS-open
[ ] Copied the closest-shaped sibling; removed .git/.netlify
[ ] Swapped espnPath in fetch/check scripts + services/espn.js + services/summary.js
[ ] Fixed OT / regulation-period math for the sport
[ ] fetch script asserts the expected total and filters interlopers
[ ] Regenerated src/data + logos; validated derivation against ESPN's own view (0 projected)
[ ] Adapted standings/bracket derivation; trimmed views + urlState VALID_VIEWS
[ ] Re-skinned identity: storage prefix, copy, URLs, accent, icon + og-image
[ ] Tests point at real data and pass; CI + refresh cron scoped to the season
[ ] Registered in the hub's viewers.js
```
