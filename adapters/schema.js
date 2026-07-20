// The league adapter — the single place a sport differs.
//
// Everything else in core/ is written against this shape, so adding a league should
// mean writing one of these and nothing else. Derived by extracting what actually
// varied across four real builds (world-cup-viewer, the-wnba-schedule,
// premier-league) plus what NBA and NFL demonstrably need.
//
// Verified 2026-07-20: ESPN serves the SAME endpoint shape for every league below.
// Only `espnPath` changes:
//   https://site.api.espn.com/apis/site/v2/sports/{espnPath}/teams
//   https://site.api.espn.com/apis/site/v2/sports/{espnPath}/teams/{abbr}/schedule
//   https://site.api.espn.com/apis/site/v2/sports/{espnPath}/scoreboard?dates=…
//   https://site.api.espn.com/apis/v2/sports/{espnPath}/standings
// That single fact is why this framework is viable at all.

/**
 * @typedef {Object} LeagueAdapter
 *
 * ── Identity ────────────────────────────────────────────────────────────────
 * @property {string}  id            Short slug: 'nba' | 'nfl' | 'wnba' | 'epl'
 * @property {string}  name          Display name: 'NBA'
 * @property {string}  title         Page title: 'The NBA Schedule'
 * @property {number}  season        Season year the data is generated for
 * @property {string}  espnPath      'basketball/nba' | 'football/nfl' | 'soccer/eng.1'
 * @property {string}  storageKey    localStorage namespace, e.g. 'nba' → 'nba:theme'
 * @property {string}  accent        Brand accent hex (UI chrome only — never a data mark)
 *
 * ── Vocabulary ──────────────────────────────────────────────────────────────
 * Copy differs more than logic does. Getting this wrong makes an app feel foreign.
 * @property {string}  gameNoun      'game' | 'match' | 'fixture'
 * @property {string}  periodNoun    'quarter' | 'half' | 'period'
 * @property {number}  regulationPeriods  4 (NBA/NFL/WNBA) | 2 (soccer)
 * @property {string}  homeAwaySep   '@' (US) | 'v' (UK)
 *
 * ── Standings model ─────────────────────────────────────────────────────────
 * The biggest real divergence. Three shapes cover all five leagues:
 *   'winloss'  — W-L, ranked by win%, gamesBehind        (NBA, WNBA)
 *   'winlosstie' — W-L-T, ties count as half a win       (NFL)
 *   'points'   — W-D-L, 3/1/0, ranked by pts then GD     (EPL, World Cup groups)
 * @property {'winloss'|'winlosstie'|'points'} standingsModel
 * @property {number}  [winPoints]   points model only, default 3
 * @property {number}  [drawPoints]  points model only, default 1
 * @property {string[]} tiebreakers  Ordered: 'headToHead'|'goalDiff'|'pointDiff'|
 *                                   'goalsFor'|'winPctVsWinning'|'random'
 *
 * ── Grouping ────────────────────────────────────────────────────────────────
 * @property {'conference'|'division'|'group'|'none'} groupBy
 * @property {Object.<string,string>} [groups]  key → display name
 * @property {Object.<string,string>} [groupByTeam]  team abbr → group key.
 *   ESPN's teams feed does NOT carry conference, so this must be declared.
 *
 * ── Time axis ───────────────────────────────────────────────────────────────
 * NFL is week-first; everything else is date-first. This changes the primary
 * schedule view, not just a label.
 * @property {'date'|'week'} timeAxis
 * @property {number}  [gameLengthMs]  For the "probably still live" window
 *
 * ── Season fetch strategy ─────────────────────────────────────────────────────
 * Verified 2026-07-20: soccer has NO per-team schedule endpoint (HTTP 400), so it
 * must walk the published calendar instead. This is a hard ESPN constraint, not a
 * preference — see scripts/lib/espn.mjs fetchSeason.
 *   'team-schedule'  teams/{abbr}/schedule    (NBA, NFL, WNBA)
 *   'calendar-walk'  scoreboard by date window (soccer)
 * @property {'team-schedule'|'calendar-walk'} seasonStrategy
 *
 * ── Postseason ──────────────────────────────────────────────────────────────
 *   'series'      — best-of bracket           (NBA, WNBA)
 *   'single'      — single-elimination        (NFL, World Cup knockout)
 *   'none'        — league table decides it   (EPL)
 * @property {'series'|'single'|'none'} postseason
 * @property {number}  [playoffSpots]           8 (WNBA) | 16 (NBA incl. play-in) | 14 (NFL)
 * @property {boolean} [seedLeagueWide]         true = WNBA; false = NBA/NFL seed per conference
 * @property {Object.<string,number>} [seriesLength]  round key → best-of length
 * @property {Array<[number,number]>} [firstRoundPairs]  seed pairings
 *
 * ── Scoring frequency ───────────────────────────────────────────────────────
 * Drives whether per-event enumeration is viable, and what "live" can honestly
 * display. See docs/PLAYBOOK.md § Scoring frequency.
 * @property {'low'|'high'} scoringFrequency
 *   'low'  (soccer): enumerate goals as events; derive scorer leaderboards from
 *          them; a goal toast is meaningful; showing a scoreline is safe.
 *   'high' (basketball, and NFL by drive): use pre-aggregated season stat lines;
 *          alert on notable moments only; show the PERIOD, not a running clock.
 * @property {number}  [closeMargin]  "one score" for nailbiter alerts: 5 NBA/WNBA,
 *                                    8 NFL, 1 soccer
 *
 * ── Data volume ─────────────────────────────────────────────────────────────
 * Decides whether past games are hidden by default and whether the committed
 * snapshot needs splitting.
 * @property {number}  approxGames   ~1230 NBA · ~272 NFL · ~332 WNBA · 380 EPL
 */

export const STANDINGS_MODELS = ['winloss', 'winlosstie', 'points']
export const POSTSEASON_MODELS = ['series', 'single', 'none']
export const TIME_AXES = ['date', 'week']
export const SEASON_STRATEGIES = ['team-schedule', 'calendar-walk']

const REQUIRED = ['id', 'name', 'season', 'espnPath', 'standingsModel', 'timeAxis', 'postseason']

/** Fail loudly at startup rather than rendering something subtly wrong. */
export function validateAdapter(a) {
  const problems = []
  for (const k of REQUIRED) if (a?.[k] == null) problems.push(`missing required field: ${k}`)
  if (a?.standingsModel && !STANDINGS_MODELS.includes(a.standingsModel))
    problems.push(`standingsModel must be one of ${STANDINGS_MODELS.join('|')}`)
  if (a?.postseason && !POSTSEASON_MODELS.includes(a.postseason))
    problems.push(`postseason must be one of ${POSTSEASON_MODELS.join('|')}`)
  if (a?.timeAxis && !TIME_AXES.includes(a.timeAxis))
    problems.push(`timeAxis must be one of ${TIME_AXES.join('|')}`)
  if (a?.seasonStrategy && !SEASON_STRATEGIES.includes(a.seasonStrategy))
    problems.push(`seasonStrategy must be one of ${SEASON_STRATEGIES.join('|')}`)
  if (a?.postseason === 'series' && !a.seriesLength)
    problems.push('postseason "series" requires seriesLength')
  if (a?.groupBy && a.groupBy !== 'none' && !a.groupByTeam)
    problems.push('groupBy requires groupByTeam — ESPN\'s teams feed does not carry conference')
  if (problems.length) throw new Error(`Invalid league adapter:\n  - ${problems.join('\n  - ')}`)
  return a
}

export const withDefaults = (a) =>
  validateAdapter({
    gameNoun: 'game',
    periodNoun: 'quarter',
    regulationPeriods: 4,
    homeAwaySep: '@',
    groupBy: 'none',
    timeAxis: 'date',
    seasonStrategy: 'team-schedule',
    scoringFrequency: 'high',
    closeMargin: 5,
    winPoints: 3,
    drawPoints: 1,
    tiebreakers: ['headToHead', 'pointDiff'],
    gameLengthMs: 2.25 * 60 * 60 * 1000,
    storageKey: a.id,
    ...a,
  })
