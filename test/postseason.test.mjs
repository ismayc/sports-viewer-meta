// postseasonFromScoreboard: the scoreboard backfill every team-schedule league uses while
// ESPN's per-team feed lags the bracket. Shapes are trimmed from real scoreboards: NFL
// 2026-01-10 (wild card) and 2026-02-08 (Super Bowl), NBA 2026-04-15 (play-in) and
// 2026-04-20 (first round). Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { postseasonFromScoreboard, expandDays } from '../scripts/lib/espn.mjs'

const team = (id, abbreviation, homeAway) => ({ homeAway, team: { id, abbreviation } })
const event = (id, seasonType, ctype, competitors) => ({
  id,
  date: '2026-04-20T23:00Z',
  season: { year: 2026, type: seasonType },
  competitions: [{ type: ctype, competitors }],
})
const STD = { id: '1', abbreviation: 'STD' }
const RD16 = { id: '14', abbreviation: 'RD16' }
const NBA = new Set(['CLE', 'TOR', 'PHI', 'ORL'])
const NBA_TYPES = { 3: 'playoffs', 5: 'playin' }

test('reads the type from season.type, not the competition type', () => {
  const out = postseasonFromScoreboard(
    [
      event('po', 3, RD16, [team('5', 'CLE', 'home'), team('28', 'TOR', 'away')]),
      event('pi', 5, STD, [team('20', 'PHI', 'home'), team('19', 'ORL', 'away')]),
    ],
    NBA,
    NBA_TYPES
  )
  assert.deepEqual(
    out.map(({ ev, seasonType }) => [ev.id, seasonType]),
    [
      ['po', 'playoffs'],
      ['pi', 'playin'],
    ]
  )
})

test('skips TBD slots, regular-season games, and non-league sides', () => {
  const nfl = new Set(['NE', 'SEA'])
  const out = postseasonFromScoreboard(
    [
      event('tbd', 3, STD, [team('-1', 'TBD', 'home'), team('-2', 'TBD', 'away')]),
      event('reg', 2, STD, [team('17', 'NE', 'home'), team('26', 'SEA', 'away')]),
      event('probowl', 3, STD, [team('31', 'AFC', 'home'), team('32', 'NFC', 'away')]),
      event('sb', 3, STD, [team('17', 'NE', 'home'), team('26', 'SEA', 'away')]),
    ],
    nfl
  )
  assert.deepEqual(
    out.map(({ ev, seasonType }) => [ev.id, seasonType]),
    [['sb', 'postseason']]
  )
})

test('expandDays walks a span day by day across a month end', () => {
  assert.deepEqual(expandDays('20260130', '20260202'), ['20260130', '20260131', '20260201', '20260202'])
})
