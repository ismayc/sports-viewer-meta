// Scaffolded by scripts/gen-adapter.mjs, then reviewed by hand (2026-07-20).
// Group membership pulled from ESPN's standings tree, because the teams feed
// carries no conference or division field.
import { withDefaults } from './schema.js'

export default withDefaults({
  id: 'nfl',
  name: 'NFL',
  title: 'The NFL Schedule',
  season: 2026,
  espnPath: 'football/nfl',

  standingsModel: 'winlosstie', // ties count as half a win — NFL's only structural quirk
  timeAxis: 'week',             // NFL is week-first; the week is the primary axis, not a label
  scoringFrequency: 'high',
  closeMargin: 8,               // "one score" in football
  approxGames: 272,            // 32 teams × 17 ÷ 2

  // Single-elimination bracket; 7 seeds per conference.
  postseason: 'single',
  playoffSpots: 14,
  seedLeagueWide: false,

  groupBy: 'conference',
  groups: {
    "AFC": "American Football Conference",
    "NFC": "National Football Conference"
  },
  groupByTeam: {
  ARI: 'NFC',
  ATL: 'NFC',
  BAL: 'AFC',
  BUF: 'AFC',
  CAR: 'NFC',
  CHI: 'NFC',
  CIN: 'AFC',
  CLE: 'AFC',
  DAL: 'NFC',
  DEN: 'AFC',
  DET: 'NFC',
  GB: 'NFC',
  HOU: 'AFC',
  IND: 'AFC',
  JAX: 'AFC',
  KC: 'AFC',
  LAC: 'AFC',
  LAR: 'NFC',
  LV: 'AFC',
  MIA: 'AFC',
  MIN: 'NFC',
  NE: 'AFC',
  NO: 'NFC',
  NYG: 'NFC',
  NYJ: 'AFC',
  PHI: 'NFC',
  PIT: 'AFC',
  SEA: 'NFC',
  SF: 'NFC',
  TB: 'NFC',
  TEN: 'AFC',
  WSH: 'NFC',
  },
})
