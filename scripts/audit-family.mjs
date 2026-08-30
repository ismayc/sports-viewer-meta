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
const FAMILY = resolve(META, '..')
const JSON_OUT = process.argv.includes('--json')

// The eleven viewers plus the hub. sports-viewer-meta is not an app and is
// excluded deliberately.
const APPS = [
  'the-nba-schedule', 'the-wnba-schedule', 'the-nfl-schedule', 'premier-league',
  'world-cup-viewer', 'womens-world-cup-viewer', 'football-euros-viewer',
  'copa-america-viewer', 'fiba-womens-world-cup-viewer',
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
  const inc = vite.match(/include: \[([^\]]*)\]/)
  if (!inc || !/netlify\/functions/.test(inc[1])) {
    fail(repo, 'function-coverage', 'netlify/functions is not in coverage.include')
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
