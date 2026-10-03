#!/usr/bin/env node
// Assert the invariants this family keeps re-breaking, across every repo at once.
//
// WHY THIS EXISTS. The single most repeated failure in this family is not a bug,
// it is a ROLLOUT that stopped short and then got described as finished:
//
//   * the CI concurrency fix was recorded as "fixed family-wide" and had never
//     reached the four soccer viewers, which had no concurrency key at all
//   * the site.web.api host swap fixed scripts/ and left src/ behind in ten
//     repos, so live scores were dead in production for two weeks and the
//     silent fallback to committed data meant nothing looked broken
//   * a storage-prefix registry named two repos that do not exist and omitted
//     three that do, so two checks could never fire and three siblings went
//     unguarded
//
// Every one of those was cheap to check and expensive to believe. Each check
// below is an invariant that a real incident violated. Add one whenever a
// rollout lands, and the next "is it really family-wide?" costs one command:
//
//   node sports-viewer-meta/scripts/audit-family.mjs
//   node sports-viewer-meta/scripts/audit-family.mjs --json
//
// Node built-ins only, and it reads the working tree rather than GitHub, so it
// runs offline and reports what is on THIS machine.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const META = resolve(HERE, '..')
// AUDIT_FAMILY_ROOT points the audit at another container laid out the same way,
// so a check can be shown to fire on a mutated copy without touching a real repo.
// Canonical vendored files are still read from this meta repo.
const FAMILY = process.env.AUDIT_FAMILY_ROOT ? resolve(process.env.AUDIT_FAMILY_ROOT) : resolve(META, '..')
const JSON_OUT = process.argv.includes('--json')

// The twelve viewers plus the hub. sports-viewer-meta is not an app and is
// excluded deliberately. fiba-mens-world-cup-viewer joined the family on
// September 15, 2026 but not this list until September 19, so for four days the
// audit never looked at it, and the one check that would have noticed (the
// prefix registry below) read the hub, the only other repo that knew about it,
// as the odd one out.
const APPS = [
  'the-nba-schedule', 'the-wnba-schedule', 'the-nfl-schedule', 'premier-league',
  'world-cup-viewer', 'womens-world-cup-viewer', 'football-euros-viewer',
  'copa-america-viewer', 'fiba-womens-world-cup-viewer', 'fiba-mens-world-cup-viewer',
  'the-mens-march-madness', 'the-womens-march-madness', 'hub',
]

// Repos whose data pipeline goes through the shared ESPN transport.
// world-cup-viewer is deliberately absent: its pipeline is OpenFootball text and
// frozen post-tournament, and it never carried the vendored copy.
const FETCHERS = APPS.filter((a) => a !== 'world-cup-viewer' && a !== 'hub')

const read = (repo, p) => {
  try { return readFileSync(join(FAMILY, repo, p), 'utf8') } catch { return null }
}
const list = (repo, p) => {
  try { return readdirSync(join(FAMILY, repo, p)) } catch { return [] }
}
const files = (repo, dir, ext = '.js') => {
  const out = []
  const walk = (d) => {
    for (const e of list(repo, d)) {
      const p = `${d}/${e}`
      if (!e.includes('.')) walk(p)
      else if (e.endsWith(ext) || e.endsWith('.jsx') || e.endsWith('.mjs')) out.push(p)
    }
  }
  walk(dir)
  return out
}

const findings = []
const fail = (repo, check, detail) => findings.push({ repo, check, detail })

// ---------------------------------------------------------------------------
// 1. The ESPN host, in src/ as well as scripts/
//
// site.api.espn.com 403s both datacenter IPs and browser User-Agents, and the
// browser 403 carries no CORS headers, so the page sees only "Failed to fetch"
// and silently falls back to committed data. curl with a default UA says 200,
// which is how this survived two weeks.
// ---------------------------------------------------------------------------
for (const repo of APPS) {
  for (const dir of ['src', 'scripts', 'netlify']) {
    for (const f of files(repo, dir)) {
      const t = read(repo, f)
      // Require the URL form. Both the vendored transport and several scripts
      // NAME the bad host in a comment or a diagnostic message, on purpose, to
      // explain the 403; flagging those trains you to ignore this check.
      if (t && /https:\/\/site\.api\.espn\.com/.test(t)) {
        fail(repo, 'espn-host', `${f} uses site.api.espn.com; only site.web.api answers a browser`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Every app carries the offline guard test
// ---------------------------------------------------------------------------
for (const repo of APPS) {
  if (!read(repo, 'test/guards.test.js')) fail(repo, 'guards-test', 'test/guards.test.js is missing')
}

// ---------------------------------------------------------------------------
// 3. CI concurrency
//
// A static workflow-level `group: pages` spanning push AND pull_request lets a
// busy PR branch cancel main's queued deploy: GitHub keeps one pending run per
// group and each arrival cancels the previous pending one, cancel-in-progress
// notwithstanding. The workflow group must be per-ref; the only genuinely shared
// lock, the Pages deploy, belongs at JOB level.
// ---------------------------------------------------------------------------
for (const repo of APPS) {
  const ci = read(repo, '.github/workflows/ci.yml')
  if (!ci) { fail(repo, 'ci-workflow', '.github/workflows/ci.yml is missing'); continue }
  if (!/^concurrency:/m.test(ci)) {
    fail(repo, 'ci-concurrency', 'no workflow-level concurrency group')
  } else if (!/^concurrency:\n\s+group:.*github\.ref/m.test(ci)) {
    fail(repo, 'ci-concurrency', 'workflow-level concurrency group is not per-ref')
  }
  if (!/^\s{4}concurrency:\n\s+group: pages/m.test(ci)) {
    fail(repo, 'pages-lock', 'the Pages deploy job has no job-level `pages` concurrency group')
  }
}

// ---------------------------------------------------------------------------
// 4. The test timezone pin
//
// Not necessarily UTC: the value is per-competition (see docs/LINEAGES.md). What
// matters is that a pin exists, so a suite cannot pass on CI and fail on a
// developer's machine.
// ---------------------------------------------------------------------------
for (const repo of APPS) {
  const vite = read(repo, 'vite.config.js')
  if (vite && !/env:\s*\{[^}]*TZ/.test(vite)) fail(repo, 'tz-pin', 'vite.config.js does not pin env.TZ')
}

// ---------------------------------------------------------------------------
// 5. The refresh push cannot be a bare `git push`
//
// The job checks main out, spends minutes rebuilding data, then pushes. Anything
// that lands on main in that window rejects the push and the whole refresh is
// thrown away, with only the commit step red.
// ---------------------------------------------------------------------------
for (const repo of APPS) {
  const wf = read(repo, '.github/workflows/refresh-data.yml')
  if (!wf) continue
  if (!/rebase/.test(wf)) {
    fail(repo, 'refresh-push', 'refresh-data.yml pushes without a rebase-and-retry loop')
  }
}

// ---------------------------------------------------------------------------
// 6 & 7. Vendored files must be byte-identical to the canonical copy
//
// There is no cross-repo package (the refresh workflows run with no npm ci), so
// shared code is vendored, and a vendored file drifts silently unless something
// diffs it.
// ---------------------------------------------------------------------------
const VENDORED = [
  { path: 'scripts/lib/fetch.mjs', canonical: 'scripts/lib/fetch.mjs', repos: FETCHERS },
  { path: 'scripts/smoke-prod.mjs', canonical: 'scripts/smoke-prod.mjs', repos: APPS },
]
for (const v of VENDORED) {
  let canon
  try { canon = readFileSync(join(META, v.canonical), 'utf8') } catch { canon = null }
  if (canon == null) { fail('sports-viewer-meta', 'vendored', `canonical ${v.canonical} is missing`); continue }
  for (const repo of v.repos) {
    const copy = read(repo, v.path)
    if (copy == null) fail(repo, 'vendored', `${v.path} is missing`)
    else if (copy !== canon) fail(repo, 'vendored', `${v.path} differs from the canonical copy`)
  }
}

// ---------------------------------------------------------------------------
// 8. The storage-prefix registry agrees across all twelve guard files
//
// FAMILY is deliberately duplicated (the repos share no package and the guard
// must run offline), so the only thing that keeps the copies honest is a check
// that compares them.
// ---------------------------------------------------------------------------
const registries = new Map()
for (const repo of APPS) {
  const t = read(repo, 'test/guards.test.js')
  if (!t) continue
  const prefixes = [...t.matchAll(/'([a-z0-9]{2,7}):'/g)].map((m) => m[1]).sort()
  if (prefixes.length) registries.set(repo, [...new Set(prefixes)].join(','))
}
const tally = new Map()
for (const [repo, reg] of registries) {
  if (!tally.has(reg)) tally.set(reg, [])
  tally.get(reg).push(repo)
}
if (tally.size > 1) {
  const majority = [...tally.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  for (const [reg, repos] of tally) {
    if (reg === majority[0]) continue
    for (const repo of repos) {
      fail(repo, 'prefix-registry', `guards FAMILY list differs from the other ${majority[1].length} repos`)
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Test files run one at a time
//
// Vitest's v8 provider merges each worker's coverage after the run, and with
// files in parallel that merge races. Three symptoms, one fault: an ENOENT
// reading a departed worker's temp JSON, an unstable percentage between
// identical runs, and a function reported uncovered while its own test
// exercises it. All three were diagnosed as separate problems first.
// ---------------------------------------------------------------------------
for (const repo of APPS) {
  const vite = read(repo, 'vite.config.js')
  if (vite && !/fileParallelism:\s*false/.test(vite)) {
    fail(repo, 'file-parallelism', 'vite.config.js does not set fileParallelism: false')
  }
}

// ---------------------------------------------------------------------------
// 10. The serverless functions are inside the coverage gate
// ---------------------------------------------------------------------------
for (const repo of APPS) {
  if (!existsSync(join(FAMILY, repo, 'netlify/functions'))) continue
  const vite = read(repo, 'vite.config.js') || ''
  // Scoped to the coverage block. A config can carry a `test.include` as well (the WNBA
  // viewer's does, to separate its live-data suite), and matching the first `include: [`
  // in the file read that one and reported a covered function as uncovered.
  const coverage = vite.slice(Math.max(0, vite.indexOf('coverage:')))
  const inc = coverage.match(/include: \[([^\]]*)\]/)
  if (!inc || !/netlify\/functions/.test(inc[1])) {
    fail(repo, 'function-coverage', 'netlify/functions is not in coverage.include')
  }
}

// ---------------------------------------------------------------------------
// 11. Two phone-width faults in the diverging margin chart
//
// Both shipped unnoticed because every check the family runs is a test suite or
// a desktop screenshot, and neither renders a 390px viewport.
//
//   a. The value label is clamped (`min(..., calc(100% - Npx))`) so a long bar
//      cannot push it out of the card. On a narrow track a full-length bar then
//      meets the clamp and the label prints ON TOP of its own bar. The fix the
//      NBA and March Madness viewers already carried is an --arm-scale the bar
//      width AND the label offset both multiply by, set to 0.68 in the mobile
//      media query. The PL and NFL viewers were missing it (September 19, 2026).
//
//   b. Hiding the club/team NAME in the mobile media query, leaving the crest as
//      the only label. It reads fine until a row has no crest (the PL chart's
//      relegated clubs), and then the row is blank. Show the name and let it
//      ellipsize instead.
//
// `node sports-viewer-meta/scripts/scan-mobile.mjs` catches both in a real
// browser; these two static checks catch them without one.
// ---------------------------------------------------------------------------
for (const repo of APPS) {
  const css = read(repo, 'src/index.css')
  if (!css || !/^\.margin-bar\s*\{/m.test(css)) continue

  const clamped = /\.margin-label\.(?:pos|neg)\s*\{[^}]*min\(/.test(css)
  if (clamped && !/--arm-scale/.test(css)) {
    fail(repo, 'margin-arm-scale', 'clamped margin label with no --arm-scale: a long bar runs under its own value label on a phone')
  }
  if (/@media[^{]*max-width[^{]*\{(?:[^{}]|\{[^{}]*\})*?\.margin-(?:club|team)\s+span\s*\{[^}]*display:\s*none/.test(css)) {
    fail(repo, 'margin-name-hidden', 'the margin chart hides its club/team name at phone width, leaving a crest-only (or blank) row')
  }
}

// ---------------------------------------------------------------------------
// 12. A postseason read from the team feed is also read from the scoreboard
//
// ESPN's per-team schedule feed (`seasontype=3`) lags the bracket by days. On
// September 25, 2026 it was empty for every WNBA team while the scoreboard listed
// the first round, and the playoff games reached the Schedule and Playoffs tabs
// only after a hand-forced fix. Any viewer that asks the team feed for a
// postseason must also read the scoreboard's `season.type` (the competition
// `type` there is "STD" or a round code, so a parser keyed on it drops every
// postseason game). See PLAYBOOK §2, trap 8, and postseasonFromScoreboard in
// scripts/lib/espn.mjs.
// ---------------------------------------------------------------------------
for (const repo of APPS) {
  const t = read(repo, 'scripts/fetch-schedule.mjs')
  if (!t || !/teams\/\$\{[^}]+\}\/schedule\?[^`]*seasontype=/.test(t)) continue
  if (!/for \(const type of \[[^\]]*\b3\b/.test(t)) continue
  if (!/season\?\.type/.test(t)) {
    fail(repo, 'postseason-scoreboard', 'reads the postseason only from the per-team feed, which lags the bracket by days; also read it from the scoreboard')
  }
}

// ---------------------------------------------------------------------------
// 13. The live-league workflows carry every hardening, not just the one that
//     was fixed last
//
// The four live leagues run the same four workflows, and every fix to them has
// been made in one repo and then rolled to the others by hand. On September 29,
// 2026 the data-freshness monitor was hardened in NBA and copied to the other
// three; nothing would have noticed a missed one. The files legitimately differ
// (league names, fetch commands, cron minutes, the fetch step's name, PL's
// history tables), so whole-file equality would fire on every one of those.
// Instead each assertion below names one hardening and the incident behind it,
// and only the two files that are meant to be identical are compared byte for
// byte.
//
// The step parser is just enough YAML for these files: a step starts at a `- `
// line at the indent of the first item under a `steps:` key, and comment lines
// are dropped so a hardening that is only DESCRIBED in a comment does not count.
// ---------------------------------------------------------------------------
const LIVE = ['the-nba-schedule', 'the-wnba-schedule', 'the-nfl-schedule', 'premier-league']
const WF = '.github/workflows'

const stepsOf = (yml) => {
  const lines = yml.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)steps:\s*$/)
    if (!m) continue
    const base = m[1].length
    let dash = -1
    let cur = null
    for (i++; i < lines.length; i++) {
      const l = lines[i]
      if (/^\s*#/.test(l)) continue
      if (!l.trim()) { if (cur) cur.push(l); continue }
      const ind = l.match(/^\s*/)[0].length
      if (ind <= base) { i--; break }
      const item = /^\s*- /.test(l)
      if (dash < 0 && item) dash = ind
      if (item && ind === dash) { cur = [l]; out.push({ lines: cur, dash }) } else if (cur) cur.push(l)
    }
  }
  return out.map(({ lines: ls, dash }) => {
    const text = ls.join('\n')
    const key = (k) => {
      const r = new RegExp(`^(?: {${dash}}- | {${dash + 2}})${k}:\\s*(.*)$`, 'm')
      const v = text.match(r)
      return v ? v[1].replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2').trim() : undefined
    }
    return { text, name: key('name'), id: key('id'), if: key('if'), shell: key('shell'), coe: key('continue-on-error') }
  })
}
// The body of a top-level key (`env:`, `permissions:`), or of a job under `jobs:`.
const blockOf = (yml, key, indent = 0) => {
  const m = yml.match(new RegExp(`^ {${indent}}${key}:[^\\n]*\\n((?:(?: {${indent + 1},}[^\\n]*| *#[^\\n]*)?\\n)*)`, 'm'))
  return m ? m[1] : null
}
const envOf = (yml, k) => {
  const env = blockOf(yml, 'env') || ''
  const m = env.match(new RegExp(`^\\s+${k}:\\s*(['"]?)(.*?)\\1\\s*(?:#.*)?$`, 'm'))
  return m ? m[2] : null
}
const grants = (block) => new Set([...(block || '').matchAll(/^\s+([a-z-]+):\s*(write|read)\b/gm)].map((g) => `${g[1]}: ${g[2]}`))

// 13a. A step that pipes into tee runs under `shell: bash`, family-wide.
//
// GitHub's default shell is `bash -e`, with no pipefail, so a pipe's status is
// tee's, which always succeeds. On August 16, 2026 the season watch's fetch was
// 403ing and the step stayed green, `released` came out empty, and every
// downstream step skipped silently. The refresh gate and the clock rehearsal pipe
// into tee for the same reason (to keep a log), and a red gate would read as green.
for (const repo of APPS) {
  for (const f of list(repo, WF).filter((e) => /\.ya?ml$/.test(e))) {
    const yml = read(repo, `${WF}/${f}`)
    if (!yml) continue
    const wfBash = /^defaults:\s*\n\s+run:\s*\n\s+shell:\s*bash\b/m.test(yml)
    for (const s of stepsOf(yml)) {
      if (!/\|\s*tee\b/.test(s.text)) continue
      if (wfBash || s.shell === 'bash' || /set -[a-z]*o pipefail|set -o pipefail/.test(s.text)) continue
      fail(repo, 'tee-pipefail', `${WF}/${f} step "${s.name || s.id || '(unnamed)'}" pipes into tee without \`shell: bash\`, so a failure before the pipe reads as green`)
    }
  }
}

// 13b. Files that are meant to be identical across the four are identical.
//
// data-freshness.yml has no per-league line in it (it reads the refresh by
// workflow file name and step name, which 13c pins), so any difference is a
// hardening that reached some repos and not others. node-guard.yml is a
// three-line caller of the shared guard and has no reason to differ either.
for (const f of ['data-freshness.yml', 'node-guard.yml']) {
  const copies = new Map()
  for (const repo of LIVE) {
    const t = read(repo, `${WF}/${f}`)
    if (t == null) fail(repo, 'live-workflows', `${WF}/${f} is missing`)
    else copies.set(repo, t)
  }
  const tallies = new Map()
  for (const [repo, t] of copies) {
    if (!tallies.has(t)) tallies.set(t, [])
    tallies.get(t).push(repo)
  }
  if (tallies.size > 1) {
    const [majority, agree] = [...tallies.entries()].sort((a, b) => b[1].length - a[1].length)[0]
    for (const [t, repos] of tallies) {
      if (t === majority) continue
      for (const repo of repos) fail(repo, 'live-workflows', `${WF}/${f} differs from ${agree.join(', ')}`)
    }
  }
}

// 13c. The refresh workflow's hardenings, one assertion per incident.
const titles = { GATE_ISSUE: new Map(), STALE_ISSUE: new Map() }
for (const repo of LIVE) {
  const yml = read(repo, `${WF}/refresh-data.yml`)
  if (!yml) { fail(repo, 'live-workflows', `${WF}/refresh-data.yml is missing`); continue }
  const steps = stepsOf(yml)
  const byId = (id) => steps.find((s) => s.id === id)
  const say = (msg) => fail(repo, 'live-workflows', `refresh-data.yml: ${msg}`)

  // Four of the ten red refreshes from August 23 to September 6, 2026 were an
  // ESPN 5xx or a truncated roster that cleared within the hour. So the whole
  // fetch is tried three times, and a fetch that still fails is a warning the
  // next step explains, not a red job.
  const fetch = byId('fetch')
  if (!fetch) say('no step with `id: fetch`')
  else {
    if (!/for attempt in 1 2 3\b/.test(fetch.text)) say('the fetch step has no three-attempt retry loop')
    if (fetch.coe !== 'true') say('the fetch step is not `continue-on-error: true`, so an ESPN blip turns the run red')
  }
  const explain = steps.find((s) => /steps\.fetch\.outcome == 'failure'/.test(s.if || ''))
  if (!explain) say('no step explains a fetch that did not land (`if: steps.fetch.outcome == \'failure\'`)')
  else if (!/\$STALE_ISSUE/.test(explain.text)) say('the failed-fetch step never files the stale-data issue, so days of silence stay silent')

  // The data-freshness monitor finds a successful fetch by this step's NAME, in
  // every repo, because the fetch step itself is named differently per league.
  // Rename it in one repo and that repo's monitor reads every run as a failed
  // fetch and files a false stale-data issue.
  const fresh = read(repo, `${WF}/data-freshness.yml`)
  const okStep = (fresh && envOf(fresh, 'FETCH_OK_STEP')) || 'Summarize what changed'
  const summarize = steps.find((s) => s.name === okStep)
  if (!summarize) say(`no step named "${okStep}", which data-freshness.yml keys on to see a successful fetch`)
  else if (!/steps\.fetch\.outcome == 'success'/.test(summarize.if || '')) say(`"${okStep}" does not run only on a successful fetch, so data-freshness.yml would read a failed fetch as fresh`)

  // The frozen-data gate (September 18 and 19, 2026): the main suite reads frozen
  // data, so it cannot see a refresh. The gate that can is the live suite. Before
  // the switch, the coverage gate went red six times in fourteen days on data
  // that was fine.
  const gate = byId('gate')
  if (!gate) say('no step with `id: gate`')
  else {
    if (!/npm run test:data\b/.test(gate.text)) say('the gate does not run `npm run test:data`, the live suite; the main suite reads frozen data and cannot see a refresh')
    if (gate.coe !== 'true') say('the gate step is not `continue-on-error: true`, so the step that files its issue never runs')
  }
  const gateIssue = steps.find((s) => /steps\.gate\.outcome == 'failure'/.test(s.if || ''))
  if (!gateIssue) say('no step files a red gate as an issue (`if: steps.gate.outcome == \'failure\'`)')
  else if (!/\$GATE_ISSUE/.test(gateIssue.text) || !/exit 1\s*$/.test(gateIssue.text)) say('the gate-failure step does not file $GATE_ISSUE and end red')

  // The push raced a hand push on August 29, 2026 (WNBA) and the whole refresh was
  // thrown away. Check 5 only asks for the word "rebase"; this asks for the loop.
  const commit = byId('commit')
  if (!commit) say('no step with `id: commit`')
  else if (!/for attempt in[^\n]*\n[\s\S]*git push[\s\S]*git rebase origin\/main/.test(commit.text)) say('the commit step does not retry `git push` after `git rebase origin/main` in a loop')

  // A landed commit closes BOTH signal issues. Close only one and the other stays
  // open for good, and the once-per-open-issue dedupe then never re-files it.
  const close = steps.find((s) => /steps\.commit\.outcome == 'success'/.test(s.if || '') && /gh issue close/.test(s.text))
  if (!close || !/\$GATE_ISSUE/.test(close.text) || !/\$STALE_ISSUE/.test(close.text)) say('no step closes both $GATE_ISSUE and $STALE_ISSUE after a landed commit')

  // Titles are how each issue dedupes: refresh-data.yml and data-freshness.yml
  // share STALE_ISSUE on purpose, so the two never file the same outage twice.
  for (const k of Object.keys(titles)) {
    const v = envOf(yml, k)
    if (v == null) say(`no ${k} in env`)
    else titles[k].set(repo, v)
  }
  const freshStale = fresh && envOf(fresh, 'STALE_ISSUE')
  if (freshStale != null && titles.STALE_ISSUE.get(repo) !== freshStale) {
    say(`STALE_ISSUE differs from data-freshness.yml's, so the two workflows file duplicate stale-data issues`)
  }

  // Permissions: the refresh commits, deploys Pages, and files issues. The default
  // token is read-only, and a missing `issues: write` fails only on the day there
  // is something to file.
  const perms = grants(blockOf(yml, 'permissions'))
  for (const g of ['contents: write', 'pages: write', 'id-token: write', 'issues: write']) {
    if (!perms.has(g)) say(`permissions lack \`${g}\``)
  }

  // Concurrency (August 13, 2026): a static workflow-level `pages` group here
  // held the shared slot for the whole fetch and gate and helped cancel main's
  // queued CI. The only shared lock is the deploy job's.
  const wfGroup = (blockOf(yml, 'concurrency') || '').match(/group:\s*(\S+)/)
  if (!wfGroup) say('no workflow-level concurrency group, so two refreshes can race each other')
  else if (wfGroup[1] === 'pages') say('the workflow-level concurrency group is `pages`, which holds the deploy slot for the whole fetch')
  if (!/^\s{4}concurrency:\n\s+group: pages/m.test(yml)) say('the deploy job has no job-level `pages` concurrency group')
}
// Across the four, a title that differs is a rename that did not travel.
for (const [k, m] of Object.entries(titles)) {
  const vals = new Set(m.values())
  if (vals.size < 2) continue
  const counts = [...vals].map((v) => [v, [...m.values()].filter((x) => x === v).length]).sort((a, b) => b[1] - a[1])
  for (const [repo, v] of m) {
    if (v !== counts[0][0]) fail(repo, 'live-workflows', `refresh-data.yml: ${k} "${v}" differs from the other repos' "${counts[0][0]}"`)
  }
}

// 13d. CI runs the live suite, and rehearses the next refresh.
//
// The main suite reads frozen data, so without `npm run test:data` in CI a
// committed data module is never tested at the keyboard. The rehearsal fetches
// what the next refresh would and runs the same gate: it is the only check that
// would have caught the NFL viewer's September 6, 2026 week-one break two days
// early. Its fetch must not turn CI red on an ESPN blip.
for (const repo of LIVE) {
  const yml = read(repo, `${WF}/ci.yml`)
  if (!yml) continue // check 3 reports a missing ci.yml
  const say = (msg) => fail(repo, 'live-workflows', `ci.yml: ${msg}`)
  const test = blockOf(yml, 'test', 2)
  if (!test || !/npm run test:data\b/.test(test)) say('the `test` job does not run `npm run test:data`, so the committed data modules are never tested in CI')
  const rehearsal = blockOf(yml, 'refresh-rehearsal', 2)
  if (!rehearsal) say('no `refresh-rehearsal` job gating the data the next refresh would fetch')
  else {
    const rf = stepsOf(rehearsal).find((s) => s.id === 'fetch')
    if (!rf || rf.coe !== 'true') say('the rehearsal fetch is not `continue-on-error: true`, so an ESPN blip turns CI red')
    if (!/npm run test:data\b/.test(rehearsal)) say('the rehearsal does not run the refresh gate, `npm run test:data`')
  }
}

// 13e. The season watch: once-ever guards, and a longer retry budget per day.
//
// The watch probes about 200 days per run, so one day outlasting the default
// five tries fails the run; on September 26, 2026 the WNBA watch lost a run to a
// 502 burst that the refresh two minutes later rode out. The guards test in each
// repo pins WATCH_TRIES; this catches a repo whose guard test lost the pin.
for (const repo of LIVE) {
  const yml = read(repo, `${WF}/new-season-watch.yml`)
  const say = (msg) => fail(repo, 'live-workflows', `new-season-watch.yml: ${msg}`)
  if (!yml) { say('missing'); continue }
  const perms = grants(blockOf(yml, 'permissions'))
  for (const g of ['issues: write', 'contents: write', 'pull-requests: write']) {
    if (!perms.has(g)) say(`permissions lack \`${g}\``)
  }
  // Scheduler delays bunch runs together, and the once-ever guards check before
  // they create, so two runs in flight could double-file.
  if (!/^concurrency:\n\s+group:\s*new-season-watch\b/m.test(yml)) say('no `new-season-watch` concurrency group, so two bunched runs can double-file')
  if (!/gh issue list --state all --search "\$TITLE"/.test(yml)) say('the issue guard does not search closed issues too, so closing the issue re-files it the next day')
  if (!/git ls-remote --exit-code --heads origin "\$BRANCH"/.test(yml)) say('no existing-branch guard, so the rollover PR is drafted again every day')
  const src = read(repo, 'scripts/check-new-season.mjs') || ''
  const tries = src.match(/^const WATCH_TRIES = (\d+)$/m)
  if (!tries || Number(tries[1]) < 8 || !/getJson\(`[^`]*scoreboard[^`]*`, WATCH_TRIES\)/.test(src)) {
    fail(repo, 'live-workflows', 'scripts/check-new-season.mjs: the scoreboard probe does not pass WATCH_TRIES (at least 8) to getJson, so one 502 burst reddens the daily watch')
  }
}

// ---------------------------------------------------------------------------
// 14. A tip time ESPN has not announced is never written as a tip time
//
// When the start time is unset ESPN sends `timeValid: false` and, in place of a
// time, MIDNIGHT US EASTERN on the day of the game. It is a date wearing the
// costume of an instant, and a pipeline that stores it as `tip` has already lost
// the distinction: every reader downstream is then formatting a real-looking
// clock. On October 3, 2026 the WNBA viewer offered a semifinal at "9:00 PM" on
// the evening BEFORE it was played, because 04:00Z is 9pm the previous day at
// UTC-7, and the hub did the same in its own look-ahead.
//
// What made it survive a year of scrutiny in the WNBA repo: the flag WAS handled,
// but only on the pending-slot path, which a playoff game takes only while one
// side is still "TBD". The moment the matchup was decided the game arrived on the
// ordinary path and lost the flag — so the viewer was correct right up until the
// bracket filled in, which is the point at which anyone looks.
//
// The invariant is the cheap half: a script that reads event dates out of ESPN
// must mention `timeValid` somewhere. It cannot prove the flag is carried on
// every path, but every repo that fails it is certainly storing placeholders as
// times. See docs/LINEAGES.md §6.
// ---------------------------------------------------------------------------
for (const repo of FETCHERS) {
  for (const f of ['scripts/fetch-schedule.mjs', 'src/services/espn.js']) {
    const src = read(repo, f)
    if (!src) continue
    // Only the files that actually take a date off an ESPN event.
    if (!/\bev\.date\b|\bevent\.date\b|\.date\)\.toISOString\(\)/.test(src)) continue
    if (!/timeValid/.test(src)) {
      fail(repo, 'tip-tbd', `${f} stores ESPN's event date as a tip without checking timeValid, so an unannounced start is published as a real time (midnight ET, which reads as the previous evening west of Eastern)`)
    }
  }
}

// ---------------------------------------------------------------------------

if (JSON_OUT) {
  console.log(JSON.stringify({ checked: APPS.length, findings }, null, 2))
} else if (findings.length === 0) {
  console.log(`All invariants hold across ${APPS.length} repos.`)
} else {
  const byRepo = new Map()
  for (const f of findings) {
    if (!byRepo.has(f.repo)) byRepo.set(f.repo, [])
    byRepo.get(f.repo).push(f)
  }
  for (const [repo, fs] of byRepo) {
    console.log(`\n${repo}`)
    for (const f of fs) console.log(`  [${f.check}] ${f.detail}`)
  }
  console.log(`\n${findings.length} finding(s) across ${byRepo.size} repo(s), ${APPS.length} checked.`)
}
process.exit(findings.length ? 1 : 0)
