#!/usr/bin/env node
// Run a sibling's own coverage gate at a FUTURE instant, with its committed data
// left exactly as it is on disk. The question every suite in this family has to
// answer is not "does it pass?" but "does it still pass on a day nobody commits
// anything?", and those have different answers.
//
// WHY THIS EXISTS. On 2026-09-04 a sweep injected future SCORES into each repo's
// committed data and fixed what broke. That sweep found real failures and missed a
// whole class, because a viewer reads two moving things and only one of them is
// data:
//
//   * fiba-womens-world-cup-viewer — six WeekView tests asserting on a September 4
//     game, where WeekView opens on the calendar week containing today and weeks run
//     Sunday to Saturday. Green on September 5, red on Sunday September 6, committed
//     board byte-identical. One more App test died on September 9, the day after the
//     game whose card it looked for, because the app collapses a past day's section.
//   * wnba-schedule — week.test.jsx rendered the LIVE board at the real clock, so
//     which WeekView branches it reached depended on what was on the calendar that
//     afternoon. Its coverage gate was already dipping below 100% hours after a
//     refresh had passed the same gate.
//   * nfl-schedule and nba-schedule — both had been "fixed" by the data sweep, with
//     frozen preseason fixtures, and both were still exposed. Freezing the board is
//     half the job: "upcoming" is a comparison against Date.now(), so a frozen board
//     still slides into the past as the calendar moves.
//   * both march-madness repos — a countdown branch that becomes unreachable once
//     its fixture's tip is in the past. Every test green, coverage at 99.9%, which
//     fails the gate just as hard.
//
// HOW IT WORKS. A generated vitest config imports the repo's own vite.config.js and
// prepends test/clock-shim.js to setupFiles; nothing in the repo is written to. Run
// the COVERAGE command, not the tests: two of the six findings above were coverage
// drops with a fully green suite (docs/PLAYBOOK.md §6).
//
// USAGE
//   node sports-viewer-meta/scripts/rehearse-clock.mjs
//   node sports-viewer-meta/scripts/rehearse-clock.mjs --repo the-nba-schedule
//   node sports-viewer-meta/scripts/rehearse-clock.mjs --repo the-nba-schedule \
//     --at 2026-10-20 --at 2027-06-20
//   node sports-viewer-meta/scripts/rehearse-clock.mjs --json
//
// Pick the instants from the calendar the viewer actually lives on: the day after
// its next fixture, the day its season opens, the day its last game is played, the
// following off-season. The default ladder below is a starting point, not a
// substitute for knowing when that sport's state changes.
//
// Node built-ins only, and it reads the working tree rather than GitHub, so it runs
// offline and reports what is on THIS machine. PULL FIRST: these repos take several
// bot commits a day and a stale checkout is not evidence.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const META = resolve(HERE, '..')
const FAMILY = resolve(META, '..')
const SHIM = join(META, 'test', 'clock-shim.js')

// The eleven viewers plus the hub, matching scripts/audit-family.mjs.
const APPS = [
  'the-nba-schedule', 'the-wnba-schedule', 'the-nfl-schedule', 'premier-league',
  'world-cup-viewer', 'womens-world-cup-viewer', 'football-euros-viewer',
  'copa-america-viewer', 'fiba-womens-world-cup-viewer',
  'the-mens-march-madness', 'the-womens-march-madness', 'hub',
]

// A generic ladder, denser at the near end because that is where a finding is urgent:
// a break three days out gives you three days. Enough rungs to catch "the week rolled
// over", "the season started", "the season ended" and "the off-season" without knowing
// which sport this is. The FIBA break that prompted all this was two days out.
const LADDER_DAYS = [1, 3, 8, 30, 90, 180, 365]

function parseArgs(argv) {
  const repos = []
  const dates = []
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--repo') repos.push(argv[++i])
    else if (a === '--at') dates.push(argv[++i])
    else if (a === '--help' || a === '-h') return { help: true }
    else return { error: `unknown argument ${a}` }
  }
  return { repos, dates, json }
}

// Accept a bare day ("2027-06-20") as midday UTC, so a caller does not have to think
// about which side of midnight they landed on, and accept a full instant as given.
function toInstant(s) {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00.000Z` : s
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`--at ${s} is not a date I can parse`)
  return d.toISOString()
}

function defaultDates() {
  const now = Date.now()
  return LADDER_DAYS.map((d) => new Date(now + d * 86400_000).toISOString())
}

// The generated config: the repo's own vite.config.js with the shim prepended.
//
// Three details that are all load-bearing:
//   * .mjs, because a .js config in a temp dir has no package.json above it saying
//     "type": "module", and vite's native config loader then reads it as CommonJS.
//   * setupFiles are repo-relative in every sibling, and this config does not live
//     in the repo, so they are rewritten to absolute paths.
//   * server.fs.allow has to name the meta repo. The shim sits outside the test
//     root, so without this vite refuses to serve it and every test file fails to
//     load with "Cannot find module /@fs/...", which reads like a real finding and
//     is not one.
function writeConfig(dir, repoPath) {
  const cfg = join(dir, 'vitest.rehearsal.config.mjs')
  writeFileSync(
    cfg,
    [
      `// GENERATED by sports-viewer-meta/scripts/rehearse-clock.mjs. Not written to the repo.`,
      `import base from ${JSON.stringify(`file://${repoPath}/vite.config.js`)}`,
      ``,
      `const t = base.test ?? (base.test = {})`,
      `const own = (t.setupFiles ?? []).map((f) =>`,
      `  f.startsWith('.') ? ${JSON.stringify(repoPath)} + f.slice(1) : f,`,
      `)`,
      `t.setupFiles = [${JSON.stringify(SHIM)}, ...own]`,
      `t.root = ${JSON.stringify(repoPath)}`,
      `base.server = { ...(base.server ?? {}), fs: { allow: [${JSON.stringify(repoPath)}, ${JSON.stringify(META)}] } }`,
      ``,
      `export default base`,
      ``,
    ].join('\n'),
  )
  return cfg
}

const stripAnsi = (s) => s.replace(/\[[0-9;]*m/g, '')

// What actually went wrong, in one line. A failed test and a dried-up branch are
// different problems with the same exit code, and the second is the one people miss.
function summarize(out) {
  const clean = stripAnsi(out)
  const failed = [...clean.matchAll(/^ FAIL {2}(.+)$/gm)].map((m) => m[1].trim())
  const thresholds = [...clean.matchAll(/^ERROR: Coverage for (\w+) \(([\d.]+)%\)/gm)].map(
    (m) => `${m[1]} ${m[2]}%`,
  )
  return { failed, thresholds }
}

function rehearse(repo, instants) {
  const repoPath = join(FAMILY, repo)
  if (!existsSync(join(repoPath, 'vite.config.js'))) {
    return [{ repo, instant: null, ok: false, error: 'no vite.config.js' }]
  }
  const dir = mkdtempSync(join(tmpdir(), `rehearse-${repo}-`))
  const cfg = writeConfig(dir, repoPath)

  return instants.map((instant) => {
    const run = spawnSync(
      'npm',
      ['run', 'test:coverage', '--', '--config', cfg],
      { cwd: repoPath, env: { ...process.env, SIM_NOW: instant }, encoding: 'utf8' },
    )
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
    return { repo, instant, ok: run.status === 0, ...summarize(out) }
  })
}

const args = parseArgs(process.argv.slice(2))

if (args.help || args.error) {
  if (args.error) console.error(`rehearse-clock: ${args.error}\n`)
  console.log(
    'Usage: rehearse-clock.mjs [--repo <name>]... [--at <YYYY-MM-DD|ISO>]... [--json]',
  )
  process.exit(args.error ? 2 : 0)
}

const repos = args.repos.length ? args.repos : APPS

let instants
try {
  instants = args.dates.length ? args.dates.map(toInstant) : defaultDates()
} catch (e) {
  console.error(`rehearse-clock: ${e.message}`)
  process.exit(2)
}

const results = repos.flatMap((r) => rehearse(r, instants))

if (args.json) {
  console.log(JSON.stringify({ instants, results }, null, 2))
} else {
  for (const r of results) {
    const when = r.instant ? r.instant.slice(0, 10) : '—'
    if (r.ok) {
      console.log(`PASS  ${r.repo.padEnd(30)} ${when}`)
    } else if (r.error) {
      console.log(`SKIP  ${r.repo.padEnd(30)} ${when}  ${r.error}`)
    } else {
      const why = [
        r.failed.length ? `${r.failed.length} test(s) failed` : null,
        r.thresholds.length ? `coverage: ${r.thresholds.join(', ')}` : null,
      ].filter(Boolean).join('; ') || 'exited non-zero'
      console.log(`FAIL  ${r.repo.padEnd(30)} ${when}  ${why}`)
      for (const f of r.failed) console.log(`        ${f}`)
    }
  }
}

// Exit codes are distinct on purpose: 1 means a repo is genuinely exposed, 2 means
// one could not be checked at all. Collapsing the two would let a repo that silently
// stopped being reachable read as a finding, or worse, as a pass.
if (results.some((r) => r.error)) process.exit(2)
process.exit(results.some((r) => !r.ok) ? 1 : 0)
