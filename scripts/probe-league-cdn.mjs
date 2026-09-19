#!/usr/bin/env node
// Probe the NBA/WNBA league CDN and say whether it is usable from wherever this runs.
//
// WHY THIS EXISTS. The September 18, 2026 scan of free ESPN alternatives found that
// cdn.wnba.com and cdn.nba.com serve keyless static JSON with schedule, venues, and
// broadcasters (national plus home and away), which would make a useful advisory
// cross-check for two known ESPN problems: a "final" flag that lags the game, and
// broadcast fields that flap on older games. The scan verified the CDN from a
// residential IP only. Whether a GitHub Actions runner can reach it was left
// unverified, and that is the whole question, because the refresh runs on a runner.
//
// THE TRAP THIS SCRIPT EXISTS TO CATCH. A plain curl gets 403. A near-miss header set
// gets **HTTP 200 with a small HTML error page**, so a status check alone reports
// success on a failure. Every check here validates the payload: it must parse as JSON
// and carry the shape we would actually consume.
//
// It shells out to curl rather than using fetch on purpose. The header set below is
// the one verified to work on September 18, 2026, including an explicit
// `Accept-Encoding` that undici would otherwise manage itself, and reproducing it
// exactly is the point of the probe.
//
// USAGE
//   node sports-viewer-meta/scripts/probe-league-cdn.mjs
//   node sports-viewer-meta/scripts/probe-league-cdn.mjs --league wnba
//
// Exits 0 only if every required check passed. Node built-ins only, like every
// script here.

import { execFileSync } from 'node:child_process'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

// The verified set. Order does not matter; presence does. Dropping any one of these
// is what produced the 200-with-HTML soft failure during the scan.
const headers = (site) => [
  'User-Agent: ' + UA,
  'Accept: */*',
  'Accept-Language: en-US,en;q=0.9',
  'Accept-Encoding: gzip, deflate, br',
  `Origin: https://www.${site}.com`,
  `Referer: https://www.${site}.com/`,
  'Connection: keep-alive',
  'Sec-Fetch-Dest: empty',
  'Sec-Fetch-Mode: cors',
  'Sec-Fetch-Site: same-site',
]

const LEAGUES = {
  wnba: { site: 'wnba', host: 'cdn.wnba.com', boardId: '10' },
  nba: { site: 'nba', host: 'cdn.nba.com', boardId: '00' },
}

const arg = (flag) => {
  const i = process.argv.indexOf(flag)
  return i === -1 ? null : process.argv[i + 1]
}

// Returns { status, bytes, contentType, body } for one request, or { error }.
function get(url, site) {
  const args = ['--silent', '--show-error', '--http1.1', '--compressed', '--max-time', '30']
  for (const h of headers(site)) args.push('-H', h)
  // Trailing newline then the status, so a body containing the marker cannot fool us.
  args.push('-w', '\n__STATUS__%{http_code}__%{content_type}', url)
  try {
    const out = execFileSync('curl', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const at = out.lastIndexOf('\n__STATUS__')
    if (at === -1) return { error: 'curl wrote no status marker' }
    const [status, contentType] = out.slice(at + '\n__STATUS__'.length).split('__')
    const body = out.slice(0, at)
    return { status: Number(status), bytes: Buffer.byteLength(body), contentType, body }
  } catch (e) {
    return { error: (e.stderr || e.message || String(e)).trim().split('\n')[0] }
  }
}

// A check passes only when the payload is the shape we would consume. `shape` gets the
// parsed JSON and returns a human-readable count string, or throws.
function check({ name, url, site, shape, required = true }) {
  const r = get(url, site)
  if (r.error) return { name, url, required, ok: false, why: `request failed: ${r.error}` }

  const head = `HTTP ${r.status}, ${r.bytes} bytes, ${r.contentType || 'no content-type'}`
  if (r.status !== 200) return { name, url, required, ok: false, why: `${head}` }

  // The soft failure: 200, but HTML rather than the JSON we asked for.
  if (/^\s*</.test(r.body)) {
    return { name, url, required, ok: false, why: `${head} — HTML error page, not JSON (the soft 403)` }
  }

  let parsed
  try {
    parsed = JSON.parse(r.body)
  } catch (e) {
    return { name, url, required, ok: false, why: `${head} — body is not JSON: ${e.message}` }
  }

  try {
    return { name, url, required, ok: true, why: `${head} — ${shape(parsed)}` }
  } catch (e) {
    return { name, url, required, ok: false, why: `${head} — parsed, wrong shape: ${e.message}` }
  }
}

const only = arg('--league')
const leagues = only ? [only] : Object.keys(LEAGUES)

const checks = []
for (const key of leagues) {
  const league = LEAGUES[key]
  if (!league) {
    console.error(`unknown league "${key}" (want one of: ${Object.keys(LEAGUES).join(', ')})`)
    process.exit(2)
  }
  const { site, host, boardId } = league

  checks.push({
    name: `${key}: season schedule`,
    url: `https://${host}/static/json/staticData/scheduleLeagueV2.json`,
    site,
    shape: (j) => {
      const dates = j?.leagueSchedule?.gameDates
      if (!Array.isArray(dates) || dates.length === 0) throw new Error('no leagueSchedule.gameDates array')
      const all = dates.flatMap((d) => d.games || [])
      if (all.length === 0) throw new Error('gameDates carried no games')
      // The reason we would want this feed at all: broadcasters ESPN drops. The keys
      // are `nationalBroadcasters` / `homeTvBroadcasters` / `awayTvBroadcasters`.
      // There is no `nationalTvBroadcasters`, and reading that name returns a
      // plausible-looking zero rather than an error, so it is named literally here.
      const natl = all.filter((g) => g.broadcasters?.nationalBroadcasters?.length).length
      const local = all.filter(
        (g) => g.broadcasters?.homeTvBroadcasters?.length || g.broadcasters?.awayTvBroadcasters?.length
      ).length
      if (natl === 0 && local === 0) throw new Error('no game carried any TV broadcaster')
      return `${dates.length} game dates, ${all.length} games, ${natl} national and ${local} local TV`
    },
  })

  // Off-season this can legitimately carry an empty slate, so it is advisory: it
  // proves reachability of the live path without asserting there are games today.
  checks.push({
    name: `${key}: today's scoreboard`,
    url: `https://${host}/static/json/liveData/scoreboard/todaysScoreboard_${boardId}.json`,
    site,
    required: false,
    shape: (j) => {
      const games = j?.scoreboard?.games
      if (!Array.isArray(games)) throw new Error('no scoreboard.games array')
      return `${games.length} games on the board (an empty board is normal off-season)`
    },
  })
}

console.log(`Probing the league CDN from ${process.env.GITHUB_ACTIONS ? 'a GitHub Actions runner' : 'this machine'}`)
console.log(`curl: ${execFileSync('curl', ['--version'], { encoding: 'utf8' }).split('\n')[0]}`)
console.log('')

const results = checks.map(check)
for (const r of results) {
  const mark = r.ok ? 'PASS' : r.required ? 'FAIL' : 'warn'
  console.log(`${mark}  ${r.name}`)
  console.log(`      ${r.url}`)
  console.log(`      ${r.why}`)
}

const failed = results.filter((r) => r.required && !r.ok)
console.log('')
if (failed.length === 0) {
  console.log('REACHABLE: every required check passed with a payload of the expected shape.')
  process.exit(0)
}
console.log(`BLOCKED: ${failed.length} of ${results.filter((r) => r.required).length} required checks failed.`)
console.log('Treat the CDN as unusable from here. Stay ESPN-primary and do not build a proxy.')
process.exit(1)
