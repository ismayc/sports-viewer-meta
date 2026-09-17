# Sports Trackers design review

Working doc for a review pass across the viewer family. Written September 8, 2026.
Reviewed live: hub, Premier League (fixtures + table), NBA schedule, Men's March
Madness bracket, at desktop (1440px) and phone (402px) widths, both themes.

**How to use this:** the two parts below (findings, then fonts/style) each end
with open questions. The consolidated question list is at the very bottom for a
quick triage session.

---

## Status (September 17, 2026): all seven findings shipped

Every actionable finding from Part A is now implemented and CI-green across the
family. Recorded here so this doc stops reading as an open backlog.

- **Q1 Brackets:** DONE (September 17). 1px elbow connectors on all 8 knockout
  viewers, ported per repo. See the `bracket-connectors-technique` memory.
- **Q2 Matchups:** DONE (September 16, commit `Cap and center the away@home
  matchup, surface the timezone once`). `max-width: 44rem` centered on NBA,
  WNBA, and NFL; the row rule still spans full width.
- **Q3 Timezone:** DONE (September 16, same commit). Surfaced once prominently,
  with a muted per-row `.zone` token kept so single-game deep-links still read.
- **Q4 Filter bar:** DONE (September 17). The filter panel collapses behind the
  `⚙ Filters` disclosure by default (`filtersOpen`, opened only for a shared
  link), and the "Try" example chips reveal only while searching, across the
  fixture viewers.
- **Q5 Hub:** DONE (September 17). Dormant viewers recess to one-line rows
  (`DormantStrip`), the hub adopts the square, ruled results-board language
  (`border-radius: 2px`), and the missing `:focus-visible` rings were added.
- **Q6 Eyebrows:** No change, as decided. Tracked-caps eyebrows are house style.
- **Q7 Live dot:** DONE. A small pulsing `--live` `.dot` marks in-progress rows
  on NBA, WNBA, NFL, and PL, and `prefers-reduced-motion` disables the pulse.

**Fonts (Part B): the one open thread.** The D3 Saira athletic type direction
was applied to the **hub only** (September 17). Decision on September 17: keep
Saira on the hub for now, and revisit rolling a font direction to the other 13
viewers down the road. The other viewers stay on Archivo. QF1, QF2, and QF3
below remain the open questions for that future pass.

---

## Triage decisions (September 16, 2026)

Triaged with Chester. Locked calls, now in implementation:

- **Q1 Brackets:** ADD 1px connector hooks. Roll to all knockout viewers
  (confirm the bracket component is shared first).
- **Q2 Matchups:** CAP the away@home inner content (~44rem, centered); the row
  rule still spans full width. NBA/WNBA/NFL.
- **Q3 Timezone:** MUTE the per-row zone and surface it once prominently. Keep a
  muted per-row token so single-game deep-links still read.
- **Q4 Filter bar:** COLLAPSE secondary control rows behind the Filters
  disclosure on mobile only; demote the "Try" example chips into the search
  field's focus/placeholder state.
- **Q5 Hub:** MATCH the viewers' square/ruled language, make dormant cards
  recessive (one-line "NFL · nothing in 2 weeks"), and add the missing
  `:focus-visible` rings (hub styles focus only on `.tp-search` today).
- **Q6 Eyebrows:** KEEP the tracked-caps eyebrows as house style. No change.
- **Q7 Live dot:** ADD a small pulsing `--live` dot on in-progress rows,
  disabled under `prefers-reduced-motion`.
- **Fonts (Part B):** DEFERRED to a follow-up session. Ship the CSS findings
  first.

**Verify item (settled with evidence):** `:focus-visible` rings and chip
wrapping are present across the viewers (world-cup 11, FIBA 7, NBA/WNBA 2 each,
etc.). The one gap is the hub, which styles focus only on `.tp-search`; folded
into Q5.

---

## Baseline (read this first)

These pages are not AI-slop, and the review starts from that. The "results
board" system is a real point of view: square corners, no drop-shadow kit, one
accent per app that never encodes data, a color-vision-validated data palette,
Archivo pushed to two width extremes for a display voice, and tabular figures
that line up. The PL table and the dark-mode bracket already read as bespoke.

So everything below is sharpening, not a reskin. The biggest wins are about
information legibility, not decoration.

**Current font wiring (verified):** every app loads one variable Archivo,
`wdth 62..125, wght 400..800`, from Google Fonts. The display voice is
`font-stretch: 118%; font-weight: 800`. One family, two extremes, one file.

---

## Part A — The seven findings

Ranked by impact. Findings 1–5 were seen directly; 6–7 are judgment calls.
Only four of the eleven viewers were opened, but they cover the three shared
layout engines (results-board list, US away@home rail, knockout bracket), so
1–4 are structural and family-wide rather than one-app bugs.

### 1. Knockout brackets have no connector lines (high)
In the March Madness region view, rounds cascade left to right (Round of 64 to
32 to Sweet 16 to Elite Eight) but nothing links a matchup to the slot it feeds.
Progression is implied by vertical position alone, and with wide inter-column
gaps the eye cannot trace who advanced from which pair.
- **Fix:** subtle elbow/hook connectors, a 1px `--rule` line from each pair's
  midpoint into the next round's slot. CSS-only, highest legibility per line.
- **Scope:** confirmed on March Madness. The bracket component is shared, so the
  World Cup / FIBA / Euros / Copa knockout rounds almost certainly inherit the
  same gap (not visually confirmed).
- **Question Q1:** is the missing connector intentional (a deliberately
  minimal bracket), or a gap to close? If closing, hooks on all knockout
  viewers or just the single-elim basketball ones?

### 2. Head-to-head matchups stretch to opposite screen edges (high)
On the NBA schedule at desktop width the away team pins far-left and the home
team far-right, with a large empty middle holding a lone `@`. The two halves of
one game lose visual association and the eye crosses the whole page to read a
single matchup.
- **Fix:** cap the matchup's inner width (roughly `max-width: 44rem`, centered)
  or pull both sides toward the `@`. Let the row rule span full width, not the
  content.
- **Scope:** the away@home rail is shared by NBA, WNBA, NFL.
- **Question Q2:** cap width, or keep full-bleed and just tighten the gap? Any
  attachment to the current wide spread?

### 3. The timezone token repeats on every row (medium)
Every fixture rail prints `GMT-7` (PL) or `MST` (NBA) under the time, on every
row. It is the same value all the way down, so it reads as static on the most
important column, the numbers.
- **Fix:** state the zone once (day band, or the header timezone control already
  carries it) and drop it from the per-row rail, or mute it far below the time.
- **Question Q3:** OK to remove the per-row zone entirely and surface it once,
  or should each row keep it for people who deep-link to a single game?

### 4. Filter chrome buries content, especially on mobile (medium/high on phones)
On PL fixtures at 402px you scroll past five stacked rows of controls (Filters /
Clear / Played / Export, then search, then services, then the "Try: team:
Arsenal" example chips, then Live/Upcoming/Finished) before a single fixture
appears. The "Try" hint chips are onboarding shown permanently.
- **Fix:** on narrow widths collapse the secondary rows behind the existing
  **Filters** disclosure by default; show only day bands and fixtures until
  asked. Demote "Try" hints into the search field's placeholder/focus state.
- **Question Q4:** should the filter bar collapse by default on mobile only, or
  everywhere? Keep the "Try" examples visible at all, or move them to focus?

### 5. Hub: repeated empty states, and a different visual language (medium)
The hub prints the identical string "Nothing for your teams on your services in
the next two weeks" on every dormant sport card, so the eye keeps re-reading a
non-event. The hub also uses rounded, bordered cards, which quietly departs from
the square-cornered results-board language every viewer it links to uses.
- **Fix:** make dormant cards recessive (dim, collapse to a one-line "NFL ·
  nothing in 2 weeks") so sports with games dominate. Consider matching the
  viewers' corner radius and rule treatment so the hub reads as one product.
- **Question Q5:** should the hub visually match the viewers (square, ruled), or
  is the softer card grid a deliberate "directory feels different" choice?

### 6. Soften a few micro-conventions that read as "generated" (low/medium)
The family leans on several of the exact tells that mark AI pages. Used
consistently here, which is better than randomly, but worth reconsidering:
tracked-out ALL-CAPS eyebrows (`YOUR NEXT MATCH`, `NATIONAL SEMIFINAL`),
middle-dot meta strings (`07:00 GMT-7 · Liverpool`), and the `→` suffix
(`GER →` on the hub). Table column-header caps are fine and standard.
- **Fix:** the eyebrows are the most replaceable. A small non-caps label in
  `--text-2`, or folding "YOUR NEXT MATCH" into the band's own styling.
- **Question Q6:** are the tracked-caps eyebrows a keeper part of the house
  style, or open to change? (This one is taste, not legibility.)

### 7. Lean into the one thing already distinctive (low effort, stand-out)
The wide-and-heavy Archivo numerals are the signature and the thing no templated
sports page has.
- Make live/final scorelines bigger in the match-detail and next-match moments;
  let the number be the hero the CSS comments say it should be.
- The champion-banner gradient is the family's one tasteful decorative moment.
  Keep it rare. Do not add gradients or hover-lift to cards elsewhere, which is
  exactly where these pages could slide toward slop.
- **Question Q7:** appetite for a signature "live" treatment (a small pulsing
  `--live` dot on in-progress rows, respecting `prefers-reduced-motion`)? It is
  motion that answers real state, so it fits, but it is a visible change.

---

## Part B — Fonts and style

### On the external skill
`ui-ux-pro-max-skill` is a generic mood-board system: 74 Google-Font pairings
and 192 industry palettes, with examples like spa/wellness (soft pink, sage,
gold CTA, warm-white background). None of that maps to data-dense scoreboards,
so it is not installed and its palettes are not used.

Two useful things from it, filtered:
- Its universal rules (4.5:1 contrast, visible focus, `prefers-reduced-motion`,
  chip wrapping / "+n" disclosure, reflow at 375/768/1024/1440) are worth
  holding the family to. **Verify:** do all viewers already show a visible
  keyboard focus ring, and do overflowing chip rows wrap or collapse to "+n"?
- It lists "dark mode" and "AI purple/pink gradients" as anti-patterns. Dark-
  first is correct for a scoreboard, so that rule does not apply here. The PL
  purple is a flat accent, not a gradient, so it is fine.

### Font directions
The current Archivo setup is strong, so these are ranked as keep-and-sharpen
first, then swaps, then a bolder experiment. Whatever is chosen, the data faces
must keep tabular lining figures (already on via `tabular-nums`); avoid faces
with old-style or quirky numerals (Poppins, Space Grotesk) in number columns.

**D1 — Keep Archivo, formalize the extremes (recommended default, lowest effort).**
Push the display voice wider (toward `wdth 125`) for scorelines, and actually
use Archivo's narrow end (toward `wdth 62`) for cramped team-name rails instead
of truncating "C Palace" / "Prairie View ...". No new fonts, no new files. This
also directly helps the narrow-row problem.

**D2 — Roboto Flex (single variable superfont).**
One file, more axes than Archivo (`opsz`, `GRAD`, width, weight). Cleaner
numerals at tiny table sizes, and the display voice comes from the same file.
Trade-off: slightly neutral/corporate, may feel less bespoke than Archivo.

**D3 — Saira family (Saira + Saira Condensed / Semi-Condensed).**
Athletic, squared, technical, a genuine scoreboard/jersey character, with native
condensed widths for narrow rails. This is the pick if the goal is to read as a
*sports* product specifically. Trade-off: strong personality, needs testing at
body/table size before committing.

**D4 — IBM Plex Sans + Plex Sans Condensed.**
The condensed cut solves the narrow team-name problem directly; a serious,
distinctive super-family. Trade-off: two files, loses the single-variable
elegance of today.

**D5 — Add one editorial display serif for the hero heading only (experiment).**
Fraunces (variable, has optical size) or Instrument Serif for the app masthead
only, all data staying in the sans. Gives each app an almanac / sports-page
voice. Highest bespoke payoff, highest risk, most per-app tuning, and it
contradicts the "one family" ethos, so it should be tried on one app first.

### Style ideas that fit and help stand out
- A signature live-state treatment (finding 7 / Q7).
- Bigger hero numerals in detail and next-match views (finding 7).
- One narrow-width team-name cut instead of truncation, tied to D1/D3/D4.

- **Question QF1:** which font direction to explore first: sharpen Archivo (D1),
  or prototype a sportier face (D3 Saira) on one app to compare side by side?
- **Question QF2:** appetite for a display serif masthead (D5) as a one-app
  experiment, or keep strictly to one sans family across the board?
- **Question QF3:** should any font change roll to all 12 at once, or prove on
  one repo first (matches the usual family rollout pattern)?

---

## Consolidated questions for a triage session

- **Q1** Brackets: add connector hooks? All knockout viewers or just basketball?
- **Q2** Matchups: cap width / center, or keep full-bleed and tighten the gap?
- **Q3** Per-row timezone: remove and show once, or keep for deep-links?
- **Q4** Mobile filter bar: collapse by default? Everywhere or mobile-only?
  Keep the "Try" example chips visible?
- **Q5** Hub: match the viewers' square/ruled language, or keep the soft grid?
- **Q6** Tracked-caps eyebrows: keep as house style, or soften?
- **Q7** Signature live-state motion: yes or no?
- **QF1** First font move: sharpen Archivo (D1) or prototype Saira (D3)?
- **QF2** Display serif masthead (D5): one-app experiment, or off the table?
- **QF3** Font rollout: all 12 at once, or prove on one repo first?
- **Verify** Do all viewers already have visible focus rings and chip
  wrapping / "+n" overflow? (Claimed by the external skill as table stakes;
  not yet confirmed here.)
