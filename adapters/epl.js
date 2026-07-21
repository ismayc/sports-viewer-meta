// Scaffolded by scripts/gen-adapter.mjs, then reviewed by hand (2026-07-20).
// Soccer diverges the most: a points table with no conferences, a calendar walk
// instead of per-team schedules, and its own vocabulary.
import { withDefaults } from './schema.js'

export default withDefaults({
  id: 'epl',
  name: 'EPL',
  title: 'The Premier League Schedule',
  season: 2026,
  espnPath: 'soccer/eng.1',

  standingsModel: 'points',    // W-D-L, 3/1/0, ranked pts → GD → GF
  // The Premier League has NEVER used head-to-head; it goes straight to goal difference.
  tiebreakers: ['goalDiff', 'goalsFor'],
  timeAxis: 'date',
  postseason: 'none',          // the table decides everything; no playoff
  scoringFrequency: 'low',     // goals are enumerable events; a scoreline is safe to show
  closeMargin: 1,              // a one-goal game
  approxGames: 380,           // 20 teams × 19 × 2 = teams × (teams − 1)

  // Soccer must walk the published calendar — it has no per-team schedule endpoint.
  seasonStrategy: 'calendar-walk',

  // Vocabulary — copy differs more than logic does.
  gameNoun: 'match',
  periodNoun: 'half',
  regulationPeriods: 2,
  homeAwaySep: 'v',

  // en-GB gives 24-hour times for free; the football week starts Monday.
  locale: 'en-GB',
  weekStart: 1,

  // No conferences — the standings tree nests by season, not by group.
  groupBy: 'none',
})
