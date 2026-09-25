// Shared fetch helpers for the data scripts.
//
// Both prior builds copy-pasted getJson/arg into every script, because the
// "no node_modules imports" CI rule was read as "no shared module at all". It isn't —
// the guard allows relative imports. This file satisfies it and removes the drift.
//
// Node built-ins only.

import { getJson, mapLimit, CONCURRENCY } from './fetch.mjs'

export { sleep, backoffMs, CONCURRENCY, mapLimit, fetchRetry, getJson, getText } from './fetch.mjs'

// All three hosts are site.web.api, NOT site.api. ESPN's edge applies a
// datacenter-egress block to site.api only: from a GitHub runner — or any cloud IP —
// every site.api request answers 403, while the same path on site.web.api answers 200.
// It is not the per-runner-IP block the refresh workflows were originally written
// against; a fresh runner does not escape it, and neither does a proxy pointed at the
// same host. Diagnosed 2026-08-16, after a family-wide refresh outage; site.web.api
// serves these route families with identical payloads (verified route by route across
// both hosts). See docs/ESPN-403.md. Do NOT "restore" the site.api host.
export const SITE = 'https://site.web.api.espn.com/apis/site/v2/sports'
export const CORE = 'https://site.web.api.espn.com/apis/v2/sports'
export const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports'

export const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

export const yyyymmdd = (d) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate()
  ).padStart(2, '0')}`

/** Inclusive UTC month range, for the scoreboard's `dates=start-end` form. */
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const p = String(m).padStart(2, '0')
  return `${y}${p}01-${y}${p}${last}`
}

export async function fetchTeams(espnPath) {
  const d = await getJson(`${SITE}/${espnPath}/teams`)
  return d.sports[0].leagues[0].teams
    .map(({ team: t }) => ({
      id: t.id,
      abbr: t.abbreviation,
      slug: (t.slug || t.abbreviation).toLowerCase(),
      name: t.name,
      location: t.location,
      displayName: t.displayName,
      color: t.color ? `#${t.color}` : null,
      altColor: t.alternateColor ? `#${t.alternateColor}` : null,
      logo: (t.logos || []).find((l) => l.rel.includes('default'))?.href || null,
      logoDark: (t.logos || []).find((l) => l.rel.includes('dark'))?.href || null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/** Both feed shapes: the schedule uses media.shortName, the scoreboard uses names[]. */
export const broadcastNames = (c) => [
  ...new Set(
    (c.broadcasts || [])
      .flatMap((b) => b.names || (b.media ? [b.media.shortName] : []))
      .filter(Boolean)
  ),
]

/**
 * Normalise one ESPN event. `classify` lets a league reclassify a game the feed
 * reports as ordinary — every league has at least one (a cup final, an exhibition).
 */
export function normalizeEvent(ev, { classify } = {}) {
  const c = ev.competitions?.[0]
  if (!c) return null
  const home = c.competitors?.find((t) => t.homeAway === 'home')
  const away = c.competitors?.find((t) => t.homeAway === 'away')
  if (!home || !away) return null

  const st = c.status?.type || {}
  const num = (v) => (v == null ? null : Number(v.value ?? v))
  const hs = num(home.score)
  const as = num(away.score)
  const venue = c.venue || {}
  const headline = (c.notes || []).map((n) => n.headline).find(Boolean)

  const game = {
    id: ev.id,
    // Always an absolute instant. Rendering into a zone is then pure formatting.
    tip: new Date(ev.date).toISOString(),
    home: home.team.abbreviation,
    away: away.team.abbreviation,
    venue: venue.fullName || null,
    city: venue.address?.city || null,
    state: venue.address?.state || null,
    neutral: c.neutralSite || undefined,
    week: ev.week?.number ?? c.week?.number,
    broadcast: broadcastNames(c).length ? broadcastNames(c) : undefined,
    // A score is written ONLY for a completed game. An in-progress score is transient
    // and belongs to the live overlay, never the committed snapshot.
    score: st.completed && Number.isFinite(hs) && Number.isFinite(as) ? [hs, as] : undefined,
    postponed: st.name === 'STATUS_POSTPONED' || undefined,
    canceled: st.name === 'STATUS_CANCELED' || undefined,
    note: headline || undefined,
  }
  return classify ? classify(game, c, ev) : game
}

/**
 * Whole season, by whichever strategy the league supports.
 *
 * Verified 2026-07-20 — this is NOT uniform across ESPN:
 *   'team-schedule'  NBA, NFL, WNBA. teams/{abbr}/schedule?season&seasontype, plus
 *                    the scoreboard for the postseason, which the team feed lags
 *                    (see postseasonFromScoreboard; opt out with postseasonTypes: null)
 *   'calendar-walk'  SOCCER. The per-team schedule endpoint returns HTTP 400 for
 *                    soccer entirely, so the scoreboard's published `calendar` has to
 *                    be walked in date windows instead.
 */
export async function fetchSeason(espnPath, teams, opts = {}) {
  const strategy = opts.strategy || 'team-schedule'
  return strategy === 'calendar-walk'
    ? fetchByCalendar(espnPath, opts)
    : fetchByTeamSchedule(espnPath, teams, opts)
}

/**
 * Walk the league's published calendar in windows.
 *
 * The scoreboard silently caps at ~50 events regardless of `limit`, so the window has
 * to stay small AND the caller must assert the expected total afterwards — a silent
 * short read looks exactly like a quiet season.
 */
export async function fetchByCalendar(espnPath, { windowDays = 10, classify } = {}) {
  const board = await getJson(`${SITE}/${espnPath}/scoreboard`)
  const calendar = (board.leagues?.[0]?.calendar || []).map((d) => String(d).slice(0, 10))
  if (!calendar.length) throw new Error(`${espnPath}: no calendar published`)

  const days = [...new Set(calendar)].sort()
  const byId = new Map()
  for (let i = 0; i < days.length; i += windowDays) {
    const from = days[i].replace(/-/g, '')
    const to = (days[Math.min(i + windowDays - 1, days.length - 1)]).replace(/-/g, '')
    const d = await getJson(`${SITE}/${espnPath}/scoreboard?dates=${from}-${to}&limit=400`)
    for (const ev of d.events || []) {
      const g = normalizeEvent(ev, { classify })
      if (g) byId.set(g.id, g)
    }
  }
  return [...byId.values()].sort((a, b) => a.tip.localeCompare(b.tip) || a.id.localeCompare(b.id))
}

/**
 * Postseason games from the scoreboard, for leagues that fetch by team schedule.
 *
 * The per-team feed (`seasontype=3`) lags ESPN's own bracket by DAYS: on 2026-09-25 it
 * was empty for every WNBA team while the scoreboard already listed the first round,
 * and two refreshes committed no playoff games until the scoreboard was read too. So
 * every team-schedule league reads the scoreboard as well, from its last regular-season
 * day through `days` days on. Rules, all verified on real 2025-26 scoreboards (NFL wild
 * card and Super Bowl, NBA play-in and first round, WNBA first round):
 *
 *   - The season type lives ONLY on `ev.season.type` there (3 postseason, 5 NBA
 *     play-in). The competition `type` is "STD" or a round code ("RD16"), so a parser
 *     keyed on it drops every postseason game. `types` maps season.type to a label.
 *   - A slot whose teams are not yet known carries "TBD" teams with negative ids; skip
 *     it until a later refresh finds it filled in. Anything that is not one of the
 *     league's own teams (the NFL Pro Bowl's AFC and NFC sides) is skipped too.
 *   - The team feed wins on overlap: callers add only ids they do not already have.
 *
 * Pure, so each viewer can test it against a trimmed real payload.
 */
export function postseasonFromScoreboard(events, knownAbbrs, types = { 3: 'postseason' }) {
  const real = (t) => Number(t.team?.id) > 0 && knownAbbrs.has(t.team?.abbreviation)
  return events
    .filter((ev) => types[Number(ev.season?.type)])
    .filter((ev) => {
      const cs = ev.competitions?.[0]?.competitors || []
      return cs.length === 2 && cs.every(real)
    })
    .map((ev) => ({ ev, seasonType: types[Number(ev.season.type)] }))
}

/**
 * How long each league's postseason runs after its last regular-season day, with room
 * to spare. NBA: play-in plus four best-of-seven rounds, mid-April to late June. NFL:
 * wild card to the Super Bowl, five weeks. WNBA: three rounds, about five weeks.
 */
export const POSTSEASON_DAYS = { 'basketball/nba': 80, 'football/nfl': 49, 'basketball/wnba': 49 }

export async function fetchPostseasonFromScoreboard(
  espnPath,
  lastRegularIso,
  teams,
  { types, days = POSTSEASON_DAYS[espnPath] ?? 60, classify } = {}
) {
  if (!lastRegularIso) return []
  const from = lastRegularIso.slice(0, 10).replaceAll('-', '')
  const to = new Date(Date.parse(lastRegularIso) + days * 86400000)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '')
  // Single-date queries only: ESPN answers every hyphenated `dates=A-B` with a 400.
  const pages = await mapLimit(expandDays(from, to), CONCURRENCY, (day) =>
    getJson(`${SITE}/${espnPath}/scoreboard?dates=${day}&limit=100`)
  )
  const byId = new Map()
  for (const d of pages) for (const ev of d.events || []) byId.set(ev.id, ev)
  const known = new Set(teams.map((t) => t.abbr))
  return postseasonFromScoreboard([...byId.values()], known, types)
    .map(({ ev, seasonType }) => {
      const g = normalizeEvent(ev)
      return g && (classify ? classify({ ...g, seasonType }, ev.competitions[0], ev) : { ...g, seasonType })
    })
    .filter(Boolean)
}

/** A YYYYMMDD span as its individual days, in UTC-day steps. */
export function expandDays(from, to) {
  const at = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))
  const out = []
  for (let t = at(from); t <= at(to); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10).replaceAll('-', ''))
  }
  return out
}

async function fetchByTeamSchedule(
  espnPath,
  teams,
  { season, seasonTypes = [2, 3], classify, postseasonTypes = { 3: 'postseason' }, postseasonDays } = {}
) {
  const byId = new Map()
  const pages = await mapLimit(teams, CONCURRENCY, async (t) => {
    const evs = []
    for (const type of seasonTypes) {
      const d = await getJson(
        `${SITE}/${espnPath}/teams/${t.abbr}/schedule?season=${season}&seasontype=${type}`
      )
      evs.push(...(d.events || []))
    }
    return evs
  })
  for (const ev of pages.flat()) {
    const g = normalizeEvent(ev, { classify })
    if (g) byId.set(g.id, g)
  }
  // The team feed lags the bracket by days (see postseasonFromScoreboard), so the
  // scoreboard fills in whatever postseason games it does not have yet. On by default:
  // a new viewer gets it without having to know about the lag.
  if (postseasonTypes) {
    const lastRegular = pages
      .flat()
      .filter((ev) => Number(ev.seasonType?.type ?? ev.seasonType?.id) === 2)
      .map((ev) => new Date(ev.date).toISOString())
      .sort()
      .at(-1)
    const extra = await fetchPostseasonFromScoreboard(espnPath, lastRegular, teams, {
      types: postseasonTypes,
      days: postseasonDays,
      classify,
    })
    for (const g of extra) if (!byId.has(g.id)) byId.set(g.id, g)
  }
  return [...byId.values()].sort((a, b) => a.tip.localeCompare(b.tip) || a.id.localeCompare(b.id))
}

/** One source line per record keeps git diffs readable. */
export const serializeArray = (name, rows) =>
  `export const ${name} = [\n${rows.map((r) => `  ${JSON.stringify(r)},`).join('\n')}\n]\n`

export const banner = (source) =>
  `// GENERATED by scripts/ — do not edit by hand.\n// Source: ${source}\n\n`
