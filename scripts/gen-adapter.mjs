#!/usr/bin/env node
// Scaffolds a league adapter with REAL data pulled from ESPN, rather than a
// hand-typed team list.
//
// This exists because of a mistake worth not repeating: ESPN's teams feed carries
// no conference or division field for ANY league (verified for NBA, NFL, WNBA).
// That mapping has to be declared by hand — and hand-typed team lists are exactly
// the kind of thing that is silently wrong for one team all season. Pulling it from
// the standings endpoint makes it correct by construction.
//
//   node scripts/gen-adapter.mjs --league nba --path basketball/nba --season 2027
//
// Node built-ins only.

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = 'https://site.api.espn.com/apis/site/v2/sports'
const CORE = 'https://site.api.espn.com/apis/v2/sports'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > -1 ? process.argv[i + 1] : d
}

const league = arg('league')
const espnPath = arg('path')
const season = Number(arg('season')) || new Date().getFullYear()

if (!league || !espnPath) {
  console.error('usage: gen-adapter.mjs --league nba --path basketball/nba [--season 2027]')
  process.exit(1)
}

const getJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.json()
}

// Groups live only in the standings tree, keyed by conference/division nodes.
// Keep BOTH the abbreviation (the stable key) and the full name (the human label):
// emitting key→key is one of the known-wrong scaffolds this generator used to produce.
function collectGroups(node, path = []) {
  const out = []
  const label = node.abbreviation || node.name
  const next = label && path.length === 0 && !node.standings ? path : [...path, label].filter(Boolean)
  if (node.standings?.entries?.length) {
    out.push({
      key: label,
      name: node.name || label,
      teams: node.standings.entries.map((e) => e.team.abbreviation),
    })
  }
  for (const child of node.children || []) out.push(...collectGroups(child, next))
  return out
}

// The scaffold defaults that are actually determined by the SPORT, not typed by hand.
// Getting these wrong (winloss/date/none for every league) was the whole reason the
// first three generated adapters had to be corrected — see docs/STATE.md. Inferring
// them from espnPath means the next league starts correct instead of correct-looking.
function sportProfile(espnPath, teamCount) {
  const sport = espnPath.split('/')[0]
  if (sport === 'soccer')
    return {
      note: 'soccer: points table, calendar walk (no per-team schedule endpoint), low scoring',
      standingsModel: 'points',
      tiebreakers: ['goalDiff', 'goalsFor'], // most soccer leagues; confirm — some use head-to-head
      timeAxis: 'date',
      postseason: 'none',
      scoringFrequency: 'low',
      closeMargin: 1,
      seasonStrategy: 'calendar-walk',
      approxGames: teamCount * (teamCount - 1), // double round-robin, exact
      groupBy: 'none',
      vocab: { gameNoun: 'match', periodNoun: 'half', regulationPeriods: 2, homeAwaySep: 'v' },
    }
  if (espnPath === 'football/nfl')
    return {
      note: 'NFL: ties count, week-first axis, single-elimination playoff',
      standingsModel: 'winlosstie',
      timeAxis: 'week',
      postseason: 'single',
      scoringFrequency: 'high',
      closeMargin: 8,
      seasonStrategy: 'team-schedule',
      approxGames: null,
    }
  if (sport === 'basketball')
    return {
      note: 'basketball: win% table, best-of-7 series bracket',
      standingsModel: 'winloss',
      timeAxis: 'date',
      postseason: 'series',
      seriesLength: { firstRound: 7, semifinals: 7, conferenceFinals: 7, finals: 7 },
      scoringFrequency: 'high',
      closeMargin: 5,
      seasonStrategy: 'team-schedule',
      approxGames: null,
    }
  return {
    note: 'UNKNOWN sport — the fields below are conservative guesses. Confirm EVERY one.',
    standingsModel: 'winloss',
    timeAxis: 'date',
    postseason: 'none',
    scoringFrequency: 'high',
    seasonStrategy: 'team-schedule',
    approxGames: null,
  }
}

const teamsDoc = await getJson(`${SITE}/${espnPath}/teams`)
const teams = teamsDoc.sports[0].leagues[0].teams.map(({ team: t }) => ({
  abbr: t.abbreviation,
  name: t.displayName,
}))

let groups = []
try {
  groups = collectGroups(await getJson(`${CORE}/${espnPath}/standings?season=${season}`))
} catch {
  console.warn('  (standings unavailable — groupByTeam left empty, fill it in by hand)')
}

const groupByTeam = {}
for (const g of groups) for (const abbr of g.teams) groupByTeam[abbr] = g.key

const missing = teams.filter((t) => !groupByTeam[t.abbr])
const lines = Object.entries(groupByTeam)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([abbr, g]) => `  ${abbr}: '${g}',`)

const p = sportProfile(espnPath, teams.length)
// A soccer season has no conferences even though ESPN nests standings under a season
// node; trust the profile over the (misleading) shape of the standings tree.
const groupBy = p.groupBy || (groups.length ? 'conference' : 'none')

const q = (v) => (typeof v === 'string' ? `'${v}'` : `${v}`)
const behaviorLines = [
  `  standingsModel: ${q(p.standingsModel)},`,
  p.tiebreakers && `  tiebreakers: ${JSON.stringify(p.tiebreakers)},`,
  `  timeAxis: ${q(p.timeAxis)},`,
  `  postseason: ${q(p.postseason)},`,
  p.seriesLength && `  seriesLength: ${JSON.stringify(p.seriesLength)},`,
  `  scoringFrequency: ${q(p.scoringFrequency)},`,
  p.closeMargin != null && `  closeMargin: ${p.closeMargin},`,
  p.seasonStrategy !== 'team-schedule' && `  seasonStrategy: ${q(p.seasonStrategy)},`,
  p.approxGames != null
    ? `  approxGames: ${p.approxGames},`
    : `  approxGames: ${teams.length} * 0, // TODO: teams × games-per-team ÷ 2`,
].filter(Boolean)

const vocabLines = p.vocab
  ? ['', '  // Vocabulary — this sport does not speak the defaults.',
     ...Object.entries(p.vocab).map(([k, v]) => `  ${k}: ${q(v)},`)]
  : []

const groupingLines =
  groupBy === 'none'
    ? [`  groupBy: 'none',`]
    : [
        `  groupBy: ${q(groupBy)},`,
        // key → human label, pulled from the standings node's full name.
        `  groups: ${JSON.stringify(
          Object.fromEntries(groups.map((g) => [g.key, g.name])),
          null,
          2
        ).replace(/\n/g, '\n  ')},`,
        `  groupByTeam: {`,
        ...lines,
        `  },`,
      ]

const file = `// Scaffolded by scripts/gen-adapter.mjs — behaviour inferred from espnPath, then
// REVIEW by hand. ${p.note}
// Group membership pulled from ESPN's standings tree, because the teams feed
// carries no conference or division field.
import { withDefaults } from './schema.js'

export default withDefaults({
  id: '${league}',
  name: '${league.toUpperCase()}',
  title: 'The ${league.toUpperCase()} Schedule',
  season: ${season},
  espnPath: '${espnPath}',

${behaviorLines.join('\n')}${vocabLines.join('\n')}

${groupingLines.join('\n')}
})
`

await mkdir(join(ROOT, 'adapters'), { recursive: true })
const out = join(ROOT, 'adapters', `${league}.js`)
await writeFile(out, file)

console.log(`${teams.length} teams · ${groups.length} groups → adapters/${league}.js`)
for (const g of groups) console.log(`  ${g.key}: ${g.teams.length}`)
if (missing.length) console.warn(`  ⚠ ungrouped: ${missing.map((t) => t.abbr).join(', ')}`)
