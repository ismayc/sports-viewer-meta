# Cross-family opportunities

Features one app in the family has (or none do) that the others should consider. Sourced
from a full scan of `world-cup-viewer` (the oldest, most feature-rich sibling) against
`the-wnba-schedule`, `premier-league`, and `the-nfl-schedule` — 2026-07-20.

Honest framing: world-cup-viewer is **not** uniformly ahead. Several items below are gaps
in *all four* apps, and in one area (where-to-watch) the WNBA app is ahead.

Status: 🔵 in progress · 🔴 not started · 🟢 done everywhere

---

## Family-wide gaps (nobody has these yet)

- 🔴 **Service worker / offline precache.** None of the four are installable-offline,
  despite each shipping a committed, zero-network snapshot — the architecture is tailor-made
  for a precache SW. Highest ceiling; build once in `core/`, apply to all four.
- 🔴 **SEO / structured data.** No `SportsEvent`/`BroadcastEvent` JSON-LD, no per-view
  `<title>` updates, no `sitemap.xml` / `robots.txt` in any app. Batch across the family.

## Worth porting from world-cup-viewer

- 🔵 **Auto-updating `webcal://` calendar subscription** (Netlify function serving a live
  `.ics`, vs our static one-time download). Best value-to-effort in the repo; self-contained.
  **QUEUED — resume here → NFL first, then WNBA + Premier League.** Nothing is committed yet.
  Reference implementation: `world-cup-viewer/netlify/functions/calendar.js` +
  `src/components/CalendarModal.jsx` + `src/utils/ics.js` (`webcalUrl`, `googleCalendarUrl`).
  Per-app plan:
  1. `src/utils/ics.js`: add `webcalUrl(httpsUrl)` = `https?:` → `webcal:`, and
     `googleCalendarUrl(httpsUrl)` = `https://www.google.com/calendar/render?cid=<webcal>`.
  2. `netlify/functions/calendar.mjs` (v2 default export): import the committed `GAMES` +
     `buildIcs` + `LEAGUE`; best-effort overlay of newly-final scores via `fetchLive` from
     `services/espn.js` (try/catch → committed on failure); support `?teams=ABBR,ABBR`;
     return `text/calendar` with `Cache-Control: public, max-age=1800`. NOT under `scripts/`,
     so the Node-built-ins-only guard doesn't apply — it may import from `src/`.
  3. `netlify.toml`: add `[functions] directory = "netlify/functions"` and a redirect
     `/calendar.ics` → `/.netlify/functions/calendar` ABOVE the SPA `/*` catch-all.
  4. `src/components/CalendarModal.jsx`: reuse the `md-*` modal shell + `useModalA11y`;
     Subscribe (webcal) / Google / Copy rows for "All games" and "My teams (n)"
     (`?teams=` from `useFollow`), plus the one-time downloads. Prod origin
     `https://<app>.netlify.app` (a localhost URL can't be subscribed to).
  5. App: replace the "📅 Export" chip with a "📅 Calendar" chip that opens the modal.
  6. `src/index.css`: port the `cal-*` classes from world-cup.
  7. **Coverage**: NFL and premier-league enforce 100% — add `calendarmodal.test.jsx` +
     ics-helper tests, and UPDATE the App export tests to go through the modal. The Netlify
     function is outside `src/**`, so it isn't coverage-measured (smoke-test `/calendar.ics`
     locally with `netlify dev` or by importing the handler).
  8. Only Netlify serves functions — the webcal URL points at the `.netlify.app` host; the
     GitHub Pages build still ships the static download.
- 🔴 **"Confirmed by N sources" score reconciliation** — a real trust signal, where a second
  free feed exists (ESPN + TheSportsDB). `world-cup-viewer/src/services/reconcile.js`.
- 🔴 **Home-timezone hover** — "kickoff in the team's local time" on hover. Cheap, delightful,
  on-brand for a timezone-first family (relevant even for NFL's London/Munich games).
  `world-cup-viewer/src/utils/time.js` `teamKickoffTooltip`.
- 🔴 **"Potential matchup" bracket** — "Winner of Game N" expands to the candidate pair,
  cascading round-by-round. Best-in-class knockout UX; a natural NFL bracket upgrade.

## Ops / hygiene

- 🔴 **Schedule-drift auto-fix PR** — siblings' `check-schedule` only validates; world-cup
  opens a ready-to-merge correction PR (`.github/workflows/schedule-check.yml`).
- 🔴 **`node-guard` workflow** (fails on deprecated-Node actions) — cheap family-wide hygiene.
- 🔴 **apple-touch-icon** — NFL and Premier League are missing it (WNBA has it).

## Reverse-port (WNBA → others)

- 🔴 **`watch.js`** — maps each game to *your actual* streaming subscriptions (YouTube TV /
  Peacock / Prime), richer than world-cup's static broadcast list.

## Not portable (world-cup-specific)

The OpenFootball contribution pipeline, FIFA Annexe C third-place projection, and the
clinch/elimination math are tied to soccer's format and data source. Value them as WC-local.
