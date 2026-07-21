// Offline proof that locale and week-start actually come from the adapter — the
// single most-copied piece of hardcoded wrongness across the family (en-US, 12-hour,
// Sunday-start in every build before this was lifted). No network; runs anywhere.
//
//   node test/time.mjs

import assert from 'node:assert/strict'
import { createTimeUtils } from '../core/utils/time.js'
import epl from '../adapters/epl.js'
import nba from '../adapters/nba.js'
import { withDefaults } from '../adapters/schema.js'

// A Saturday 19:00 UK / 2pm ET kickoff: 2026-08-15T18:00:00Z (UK is BST, +01:00).
const KO = '2026-08-15T18:00:00Z'

const us = createTimeUtils(nba)
const uk = createTimeUtils(epl)

// Locale drives the hour cycle — no separate 12/24h switch exists, by design.
assert.equal(us.formatTime(KO, 'America/New_York'), '2:00 PM')
assert.equal(uk.formatTime(KO, 'Europe/London'), '19:00')

// The hour width follows the hour cycle: 12-hour drops the leading zero, 24-hour
// keeps it — a bare "9:05" reads wrong to a UK eye. (Found adopting this in
// premier-league, whose hand-rolled version got it right.)
const NINE = '2026-08-15T08:05:00Z'
assert.equal(us.formatTime(NINE, 'Europe/London'), '9:05 AM')
assert.equal(uk.formatTime(NINE, 'Europe/London'), '09:05')

// Week bucketing: KO is a Saturday. Sunday-start weeks began Sun 9 Aug;
// Monday-start (the football week) began Mon 10 Aug.
assert.equal(us.startOfWeek(KO, 'America/New_York'), '2026-08-09')
assert.equal(uk.startOfWeek(KO, 'Europe/London'), '2026-08-10')

// A Sunday game splits the two conventions: it OPENS a US week and CLOSES a UK one.
const SUN = '2026-08-16T15:00:00Z'
assert.equal(us.startOfWeek(SUN, 'America/New_York'), '2026-08-16')
assert.equal(uk.startOfWeek(SUN, 'Europe/London'), '2026-08-10')

// The day key is numeric and therefore locale-independent — grouping must never
// change because the labels did.
assert.equal(us.dayKey(KO, 'Europe/London'), uk.dayKey(KO, 'Europe/London'))

// Adapter defaults: US leagues get en-US / Sunday without declaring anything.
assert.equal(nba.locale, 'en-US')
assert.equal(nba.weekStart, 0)
assert.equal(epl.locale, 'en-GB')
assert.equal(epl.weekStart, 1)

// validateAdapter refuses nonsense rather than rendering something subtly wrong.
assert.throws(
  () => withDefaults({ id: 'x', name: 'X', season: 2026, espnPath: 'a/b', standingsModel: 'winloss', timeAxis: 'date', postseason: 'none', weekStart: 2 }),
  /weekStart/
)
assert.throws(
  () => withDefaults({ id: 'x', name: 'X', season: 2026, espnPath: 'a/b', standingsModel: 'winloss', timeAxis: 'date', postseason: 'none', locale: 'not a locale' }),
  /locale/
)

console.log('time ✅  locale + weekStart come from the adapter (en-US/Sun vs en-GB/Mon)')
