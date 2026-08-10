#!/usr/bin/env node
// Verify every family repo's vendored scripts/lib/fetch.mjs is byte-identical to
// the canonical copy in this repo. There is no cross-repo package (the refresh
// workflows run with no `npm ci`), so the transport layer is vendored — and a
// vendored file drifts silently unless something diffs it.
//
// Run from anywhere inside ~/repos/sports-trackers:
//   node sports-viewer-meta/scripts/check-fetch-sync.mjs
//
// Exits non-zero if any copy differs or a repo that fetches lacks the file.

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const META = resolve(HERE, '..')
const FAMILY = resolve(META, '..')

// Repos whose data scripts go through the shared transport. world-cup-viewer is
// deliberately absent: its pipeline is OpenFootball-text-based and frozen
// post-tournament, and it never carried the ESPN getJson copy.
const REPOS = [
  'the-nba-schedule',
  'the-wnba-schedule',
  'the-nfl-schedule',
  'premier-league',
  'the-mens-march-madness',
  'the-womens-march-madness',
  'football-euros-viewer',
  'copa-america-viewer',
  'womens-world-cup-viewer',
]

const canonical = await readFile(join(META, 'scripts/lib/fetch.mjs'), 'utf8')

let bad = 0
for (const repo of REPOS) {
  const path = join(FAMILY, repo, 'scripts/lib/fetch.mjs')
  let copy
  try {
    copy = await readFile(path, 'utf8')
  } catch {
    console.error(`✗ ${repo}: scripts/lib/fetch.mjs MISSING`)
    bad++
    continue
  }
  if (copy === canonical) {
    console.log(`✓ ${repo}`)
  } else {
    console.error(`✗ ${repo}: scripts/lib/fetch.mjs DIFFERS from canonical`)
    bad++
  }
}

if (bad) {
  console.error(
    `\n${bad} repo(s) out of sync. Fix the canonical copy in sports-viewer-meta first,` +
      `\nthen re-copy it verbatim into each flagged repo.`
  )
  process.exit(1)
}
console.log(`\nAll ${REPOS.length} vendored copies match the canonical fetch.mjs.`)
