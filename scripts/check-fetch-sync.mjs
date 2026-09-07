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

// Repos whose data scripts go through the shared transport, derived the same way
// audit-family.mjs derives them rather than written out by hand.
//
// The hand-written list this replaces named nine repos and omitted
// fiba-womens-world-cup-viewer, which ships the file and fetches through it. So this
// script reported "All 9 vendored copies match" while never opening the tenth, and
// every vendored fetch.mjs header — fiba's included — points the reader here as its
// guarantee. A checker that silently skips a repo is worse than no checker: it is a
// claim of coverage that is not true.
//
// world-cup-viewer and hub are excluded deliberately. world-cup's pipeline is
// OpenFootball text and frozen post-tournament, and it never carried the copy; the hub
// has no data scripts at all.
const APPS = [
  'the-nba-schedule', 'the-wnba-schedule', 'the-nfl-schedule', 'premier-league',
  'world-cup-viewer', 'womens-world-cup-viewer', 'football-euros-viewer',
  'copa-america-viewer', 'fiba-womens-world-cup-viewer',
  'the-mens-march-madness', 'the-womens-march-madness', 'hub',
]
const REPOS = APPS.filter((a) => a !== 'world-cup-viewer' && a !== 'hub')

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

// The list above is still a list, so it can still go stale. This catches that: any repo
// on disk that ships scripts/lib/fetch.mjs and is NOT being checked is exactly the bug
// this script had, where fiba shipped the file and nine repos were verified.
const onDisk = []
for (const entry of await readdir(FAMILY, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'sports-viewer-meta') continue
  try {
    await stat(join(FAMILY, entry.name, 'scripts/lib/fetch.mjs'))
    onDisk.push(entry.name)
  } catch {
    /* no vendored copy here */
  }
}
const unchecked = onDisk.filter((r) => !REPOS.includes(r))
if (unchecked.length) {
  console.error(
    `\n✗ ships scripts/lib/fetch.mjs but is not in this script's list: ${unchecked.join(', ')}`,
  )
  bad += unchecked.length
}

if (bad) {
  console.error(
    `\n${bad} repo(s) out of sync. Fix the canonical copy in sports-viewer-meta first,` +
      `\nthen re-copy it verbatim into each flagged repo.`
  )
  process.exit(1)
}
console.log(`\nAll ${REPOS.length} vendored copies match the canonical fetch.mjs.`)
