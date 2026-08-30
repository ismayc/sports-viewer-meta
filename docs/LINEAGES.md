# What you inherit when you copy a sibling

A full scan of all eleven viewers plus the hub, August 30, 2026. `NEW-VIEWER.md` tells you
**which** sibling to copy, by competition shape. This tells you what copying it actually
commits you to, which divergences are principled, and which are accidents you should not
propagate.

Read this between step 0 and step 1 of `NEW-VIEWER.md`. The single most expensive mistake
available here is copying across lineages and then rewriting the data model by hand.

---

## 1. There are two lineages, and they disagree about everything nameable

Every viewer descends from one of two ancestors, and the split runs deeper than the views:

| | **US-league lineage** | **Tournament lineage** |
|---|---|---|
| members | NBA, WNBA, NFL, MM men's, MM women's | World Cup, Women's World Cup, Euros, Copa, FIBA WWC |
| schedule module | `src/data/schedule.js` | `src/data/matches.js` (FIBA renamed it `games.js`) |
| export name | `GAMES` | `MATCHES` (FIBA: `GAMES`) |
| kickoff field | `tip` | `ko` |
| team fields | `home` / `away`, **abbreviations** (`DET`, `BOS`) | `t1` / `t2`, **full names** (`Japan`, `Mali`) |
| team order | ESPN's home-first | FIBA/FIFA's printed order, which is ESPN's **away** side |
| calendar function | `netlify/functions/calendar.mjs` | `netlify/functions/calendar.js` |
| function data source | **imports committed data** from `src/` | **fetches ESPN on every request** |
| function export style | `export default` | `export const handler` |
| in-repo verification | `scripts/verify-live.mjs` | `.claude/skills/verify` |
| architecture doc | `BUILD-NOTES.md` (NBA, MM×2) or `FRAMEWORK-NOTES.md` (NFL) | `ARCHITECTURE.md` |

`premier-league` is a **hybrid** and the reason to check rather than assume: it has the
tournament lineage's `ko` field, the US lineage's `home`/`away` abbreviations, its own
module name (`fixtures.js` exporting `FIXTURES`), and a committed-data calendar function.
Copying "the soccer one" and meaning PL gets you something no other repo looks like.

**Why the calendar-function split matters most.** A committed-data function cannot drift
from the app, because it imports the same module. An ESPN-fetching function bypasses
everything the build corrects, and on August 30, 2026 that put one FIBA game in
subscribers' calendars two hours early while the app showed the right time. If you inherit
the fetching variant, you inherit that whole class: see the family memory
`live-feed-bypasses-build-corrections`, and test the feed against your committed schedule,
not against a literal.

---

## 2. Decisions the scaffold will make silently unless you make them

Each of these is genuinely per-viewer. The family's current answers are listed so you can
see there is no default to inherit.

**Which host serves the social card.** Split 6/5 with no principle behind it: `og:image`
points at `ismayc.github.io` in NBA, WNBA, MM men's, MM women's, FIBA and the hub, and at
`<app>.netlify.app` in NFL, PL and all four soccer viewers. Either is correct. What is not
optional is that the host answers 200, and that you check it with a real request to the
absolute URL, because nothing in the build, the tests or CI ever fetches one.

**The `/calendar.ics` feed lives on Netlify only.** Every viewer pins `PROD` in
`CalendarModal.jsx` to its `.netlify.app` domain, including the six whose og tags point at
Pages. That is not an inconsistency to tidy up: the feed is a `netlify.toml` redirect onto
a function, and GitHub Pages runs no functions, so `/calendar.ics` can only ever 404 there.
Do not "fix" `PROD` to match the canonical URL.

**The test timezone pin, which is not always UTC.** All twelve repos pin `env: { TZ }` in
`vite.config.js`, but to three different zones: `Australia/Sydney` in the Women's World Cup
viewer, `America/New_York` in Copa and the hub, `UTC` everywhere else. The rule the values
imply: pin to the zone that makes day headings stable for **your** competition. UTC is
right only when no game crosses a UTC day boundary, which is why it suits a Berlin
tournament tipping 09:30 to 19:00 UTC and would not suit an Australian one.

**Serial test files, everywhere.** All twelve repos set `fileParallelism: false`, and the
audit asserts it, so a new viewer should keep it rather than treat it as a slow default to
optimize away. Vitest's v8 provider merges each worker's coverage after the run, and with
files in parallel that merge races. It surfaced three times here as three apparently
different problems: an ENOENT reading a departed worker's temp JSON, an unstable percentage
between identical runs, and a function reported uncovered while its own test demonstrably
exercises it. Measured cost on 2026-08-30, on `world-cup-viewer` (the largest suite): 35s
parallel against 132s serial on a many-core laptop, but roughly a wash on a 2-core CI
runner, where the parallel run is already CPU-bound. The place the flake actually bit was
CI, so that trade is worth taking.

**Your localStorage prefix, and the twelve files that must learn it.** Prefixes in use:
`nba:` `wnba:` `nfl:` `pl:` `wc2026:` `wwc:` `euros:` `copa:` `fwwc:` `mmm:` `mmw:` `st:`.
The registry is deliberately duplicated in all twelve `test/guards.test.js` files because
the repos share no package and the guard must run offline, so adding a viewer means editing
twelve files. Do not replace this with a sync mechanism without asking.

**Your NEWS.md heading format.** Ten repos use `## 2026-08-29`; FIBA uses
`## August 30, 2026 — <title>`. Follow the fork you copied rather than the majority.

---

## 3. Reusable assets that exist in exactly one repo

These were built for the newest viewer and never back-ported. Copy them from
`fiba-womens-world-cup-viewer` rather than rediscovering them:

- **`scripts/make-og-image.mjs` and `scripts/make-icons.mjs`.** All twelve repos ship a
  `public/og-image.png`, but only FIBA can regenerate one. Everywhere else the image was a
  one-off, so a rebrand means starting over.
- **`scripts/official.mjs`, the organizer-as-authority pattern.** The organizer's published
  schedule frozen in-repo, asserted against ESPN on every fetch, with a
  `KNOWN_ESPN_TIME_BUGS` table so a known upstream error is *reported* rather than silently
  adopted or allowed to fail the build. Any viewer whose governing body publishes a
  schedule should start here. It is what caught ESPN filing a game two hours early.
- **`ARCHITECTURE.md` as a real design document.** The tournament lineage has one; the US
  lineage has thinner `BUILD-NOTES.md`. If you copy a US-league sibling, you inherit less
  written-down reasoning than you might expect.

---

## 4. Traps this scan found, all of the same shape

Every one is a copied artifact still describing the app it came from. Assume this class
exists in whatever you copy, and grep for the source app's name before trusting any comment,
config, test, or skill file:

- FIBA's `vite.config.js` credited a sibling-wide fix that only three repos had.
- FIBA's `.claude/skills/verify` was the World Cup viewer's, naming tabs and selectors the
  app does not have; the euros copy was byte-identical to it, and the Women's World Cup copy
  named Copa's directory.
- FIBA's `test/guards.test.js` listed two storage prefixes that no repo uses and omitted
  three that exist.
- FIBA's `src/services/teamNames.js` described "the 32 qualified sides" in a sixteen-team
  tournament.
- `football-euros-viewer`'s champion banner was wired to match number 104, the World Cup
  final's number, in a 51-match tournament, so it never fired.

The cheap defense is a single grep for every sibling's name and prefix immediately after the
`rsync` in `NEW-VIEWER.md` step 1, before anything else.

---

## 5. What was missing family-wide, and what closed it

This section listed three gaps when the scan ran on the morning of August 30, 2026. All
three were closed the same day, so it is now a description of what a new viewer INHERITS
rather than a list of things to build:

- **A post-deploy check.** `scripts/smoke-prod.mjs`, vendored into all twelve repos and run
  by a `smoke` job after the deploy. It reads what the repo claims about itself from
  `index.html` and `CalendarModal.jsx`, then checks it against production: every card tag
  present and answering 200, `og:image` actually an image rather than the SPA catch-all,
  `coverage.json` parseable, and the calendar feed real iCalendar with events in it. For a
  feed that fetches its own upstream it also compares every `DTSTART` against the committed
  schedule. Known, explained divergences live in `scripts/smoke-known.json`; the recurring
  one is a DELAYED game, where the committed schedule holds the actual start and the
  upstream keeps the scheduled one.
- **Coverage over `netlify/functions/`.** All eleven viewers now include it at the same 100%
  thresholds as `src`. Before this, six functions had no tests at all and the best-tested one
  was at 76% of branches, all in the defensive arms a malformed payload reaches.
- **A cross-repo audit.** `scripts/audit-family.mjs` asserts ten invariants across all twelve
  repos, each one something a real incident violated. Run it before believing any claim that
  a rollout is family-wide. It found two real faults on its first run.

The standing rule these leave behind: **when a rollout lands, add its invariant to
`audit-family.mjs`.** That is what turns "I fixed it everywhere" from a memory into a
command, and this family's most repeated failure is a rollout that stopped short and then
got described as finished.
