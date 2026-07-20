// Scaffolded by scripts/gen-adapter.mjs, then reviewed by hand (2026-07-20).
// Group membership pulled from ESPN's standings tree, because the teams feed
// carries no conference or division field.
import { withDefaults } from './schema.js'

export default withDefaults({
  id: 'nba',
  name: 'NBA',
  title: 'The NBA Schedule',
  season: 2026,
  espnPath: 'basketball/nba',

  standingsModel: 'winloss',   // W-L, ranked by win%, gamesBehind
  timeAxis: 'date',
  scoringFrequency: 'high',
  approxGames: 1230,           // 30 teams × 82 ÷ 2

  // Best-of-7 every round; seeds are per-conference (not league-wide).
  postseason: 'series',
  seriesLength: { firstRound: 7, semifinals: 7, conferenceFinals: 7, finals: 7 },
  playoffSpots: 16,            // includes the 4 play-in slots
  seedLeagueWide: false,

  groupBy: 'conference',
  groups: {
    "East": "Eastern Conference",
    "West": "Western Conference"
  },
  groupByTeam: {
  ATL: 'East',
  BKN: 'East',
  BOS: 'East',
  CHA: 'East',
  CHI: 'East',
  CLE: 'East',
  DAL: 'West',
  DEN: 'West',
  DET: 'East',
  GS: 'West',
  HOU: 'West',
  IND: 'East',
  LAC: 'West',
  LAL: 'West',
  MEM: 'West',
  MIA: 'East',
  MIL: 'East',
  MIN: 'West',
  NO: 'West',
  NY: 'East',
  OKC: 'West',
  ORL: 'East',
  PHI: 'East',
  PHX: 'West',
  POR: 'West',
  SA: 'West',
  SAC: 'West',
  TOR: 'East',
  UTAH: 'West',
  WSH: 'East',
  },
})
