#!/usr/bin/env node
// Run the family's node-guard rule locally, BEFORE pushing a workflow change.
//
// WHY THIS EXISTS. On 2026-09-06 a rollout copied `actions/upload-artifact@v4` into
// five viewers' CI in one pass. Each repo's node-guard (the ismayc/gha-guards
// node-deprecation reusable workflow) treats node20 as deprecated, and v4 runs on
// node20, so six repos went red on the same commit. The proof run on the first repo
// did not catch it because the guard is a SEPARATE workflow from the one being
// changed, and only that one was watched.
//
// WHAT IT DOES. For every `uses: owner/repo[/path]@ref` in the given workflow files
// (default: every file under .github/workflows of the given repo dirs), fetch that
// action's action.yml at that ref and read `runs.using`. Refuse node12, node16 and
// node20, the same list the guard uses. Local actions (`./...`) and reusable
// workflows (`owner/repo/.github/workflows/x.yml@ref`) are skipped, as the guard
// skips them. Docker actions pass.
//
// USAGE
//   node sports-viewer-meta/scripts/node-guard-local.mjs the-nfl-schedule hub
//   node sports-viewer-meta/scripts/node-guard-local.mjs --file path/to/ci.yml
//
// Needs `gh` authenticated (it reads public action.yml files through the API, which
// is rate-limited when anonymous). Node built-ins only, like every script here.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DEPRECATED = new Set(['node12', 'node16', 'node20'])

const args = process.argv.slice(2)
const files = []
const dirs = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file') files.push(resolve(args[++i]))
  else dirs.push(resolve(args[i]))
}
for (const d of dirs) {
  const wf = join(d, '.github', 'workflows')
  let names
  try {
    names = readdirSync(wf)
  } catch {
    console.error(`SKIP  ${d}: no .github/workflows`)
    continue
  }
  for (const n of names) if (/\.ya?ml$/.test(n) && statSync(join(wf, n)).isFile()) files.push(join(wf, n))
}
if (!files.length) {
  console.error('nothing to scan: pass repo directories or --file <workflow.yml>')
  process.exit(2)
}

// `uses:` lines only. A reusable workflow is `owner/repo/.github/workflows/...@ref`;
// a local action starts with `./`; a docker action starts with `docker://`.
const USES = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)/
const specs = new Map() // spec -> [file, ...]
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(USES)
    if (!m) continue
    const spec = m[1]
    if (spec.startsWith('./') || spec.startsWith('docker://') || spec.includes('/.github/workflows/')) continue
    if (!specs.has(spec)) specs.set(spec, [])
    specs.get(spec).push(f)
  }
}

const usingOf = new Map() // spec -> using
function runsUsing(spec) {
  const [repoPath, ref] = spec.split('@')
  const [owner, repo, ...sub] = repoPath.split('/')
  const path = [...sub, 'action.yml'].join('/')
  const tryPath = (p) => {
    try {
      const out = execFileSync(
        'gh',
        ['api', `repos/${owner}/${repo}/contents/${p}?ref=${ref}`, '--jq', '.content'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      )
      const text = Buffer.from(out.trim(), 'base64').toString('utf8')
      const m = text.match(/^\s*using:\s*['"]?([\w.-]+)/m)
      return m ? m[1] : 'unknown'
    } catch {
      return null
    }
  }
  return tryPath(path) ?? tryPath(path.replace(/action\.yml$/, 'action.yaml')) ?? 'unreadable'
}

let fail = 0
for (const [spec, where] of specs) {
  const using = runsUsing(spec)
  usingOf.set(spec, using)
  const bad = DEPRECATED.has(using)
  if (bad) fail++
  const tag = bad ? 'FAIL' : using === 'unreadable' ? 'WARN' : 'ok  '
  console.log(`${tag}  ${spec.padEnd(44)} ${using}`)
  if (bad) for (const f of new Set(where)) console.log(`        ${f}`)
}
if (fail) {
  console.log(`\n${fail} action(s) run on a deprecated Node. node-guard will go red on this push.`)
  process.exit(1)
}
console.log('\nEvery action runs on a current Node.')
