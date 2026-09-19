#!/usr/bin/env node
// Render every viewer at phone width in a real browser and report the labels
// that vanish or collide. LOCAL TOOL: not wired into CI.
//
// WHY THIS EXISTS. Everything else this family runs is a test suite or a desktop
// screenshot, and neither renders a 390px viewport, so a mobile-only layout fault
// ships and then sits there. Two were found this way on September 19, 2026, both
// in the diverging margin chart, one of them years old:
//
//   * premier-league hid the club NAME below 560px, leaving the crest as the only
//     label. Fine until a row has no crest (its relegated clubs), and then the row
//     was blank. Chester noticed it before any check did.
//   * the-nfl-schedule printed a row's value label ON TOP of its own bar at 390px:
//     the label is clamped to stay inside the card, so a full-length bar meets it.
//     The NBA and March Madness viewers already had --arm-scale for this; the NFL
//     and PL viewers never got it.
//
// The static half of both checks now lives in audit-family.mjs (check 11), which
// needs no browser. This is the half that sees what actually renders.
//
// USAGE
//   npm i playwright-core            # in any scratch dir; uses the installed Chrome
//   node sports-viewer-meta/scripts/scan-mobile.mjs
//   node sports-viewer-meta/scripts/scan-mobile.mjs --repo premier-league --width 320
//   node sports-viewer-meta/scripts/scan-mobile.mjs --json
//
// It starts each repo's own dev server on one port, in turn, clicks through every
// top-level view, and runs two probes per view. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
// on install keeps it from fetching a browser: it drives the Google Chrome already
// on the machine, headless, with a throwaway profile, so Chester's own Chrome and
// its profile are never touched.

import { spawn } from 'node:child_process'
import { readdirSync, existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAMILY = resolve(HERE, '../..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const args = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i > -1 ? args[i + 1] : fallback
}
const JSON_OUT = args.includes('--json')
const WIDTH = Number(argOf('--width', 390))
const PORT = Number(argOf('--port', 5399))
const ONLY = argOf('--repo', null)

const repos = readdirSync(FAMILY)
  .filter((d) => existsSync(join(FAMILY, d, 'package.json')) && existsSync(join(FAMILY, d, 'src')))
  .filter((d) => d !== 'sports-viewer-meta')
  .filter((d) => !ONLY || d === ONLY)

// playwright-core is deliberately not a dependency of this repo, so find it where
// it is: beside this script, or in the directory the command was run from. An ESM
// `import` resolves against this file only and ignores NODE_PATH, hence createRequire.
let chromium
{
  const bases = [import.meta.url, pathToFileURL(join(process.cwd(), 'x.js')).href]
  const problems = []
  for (const base of bases) {
    try {
      const resolved = createRequire(base).resolve('playwright-core')
      // It ships as CommonJS, so the named export is not always detected: take
      // whichever of the two shapes the import gives back.
      const mod = await import(pathToFileURL(resolved).href)
      chromium = mod.chromium ?? mod.default?.chromium
      if (chromium) break
      problems.push(`${resolved}: no chromium export`)
    } catch (err) {
      problems.push(err.message.split('\n')[0])
    }
  }
  if (!chromium) {
    console.error('playwright-core could not be loaded. In any scratch dir:')
    console.error('  npm init -y && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright-core')
    console.error('then run this script from that directory. Tried:')
    for (const p of problems) console.error(`  ${p}`)
    process.exit(2)
  }
}

const startVite = (repo) =>
  new Promise((ok, no) => {
    const p = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: join(FAMILY, repo) })
    const t = setTimeout(() => no(new Error('vite did not start in 60s')), 60000)
    p.stdout.on('data', (d) => String(d).includes('Local:') && (clearTimeout(t), ok(p)))
    p.on('exit', (c) => (clearTimeout(t), no(new Error(`vite exited ${c}`))))
  })

/**
 * A row that shows an image but whose every scrap of text is hidden. This is the
 * crest-only row: it reads as identified until the crest is missing too.
 */
const PROBE_HIDDEN_LABEL = () => {
  const out = []
  for (const el of document.querySelectorAll('*')) {
    if (!el.querySelector('.logo, img')) continue
    if (!el.textContent.trim() || el.innerText.trim()) continue
    // Report the innermost offender; its ancestors match too.
    const inner = [...el.children].some(
      (c) => c.querySelector?.('.logo, img') && c.textContent.trim() && !c.innerText.trim()
    )
    if (!inner) out.push({ text: el.textContent.trim().slice(0, 40), cls: String(el.className).slice(0, 60) })
  }
  return out
}

/** A value label printed on top of the bar it belongs to. */
const PROBE_LABEL_OVERLAP = () => {
  const out = []
  for (const row of document.querySelectorAll('.margin-row')) {
    const bar = row.querySelector('.margin-bar')
    const lab = row.querySelector('.margin-label')
    if (!bar || !lab) continue
    const b = bar.getBoundingClientRect()
    const l = lab.getBoundingClientRect()
    if (l.left < b.right - 1 && l.right > b.left + 1) {
      out.push({ row: row.innerText.replace(/\s+/g, ' ').slice(0, 40) })
    }
  }
  return out
}

const findings = []
const browser = await chromium.launch({ executablePath: CHROME, headless: true })

for (const repo of repos) {
  let vite
  try {
    vite = await startVite(repo)
  } catch (err) {
    findings.push({ repo, view: '-', kind: 'error', detail: err.message })
    continue
  }

  const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } })
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 45000 })
    const views = await page.evaluate(() =>
      [...new Set(
        // Two conventions: the league viewers wrap their tabs in `nav.views`, the
        // tournament viewers use bare `.view-btn` buttons with no nav element.
        // Missing the second silently scans eight repos' default view only.
        [...document.querySelectorAll('nav button, .views button, [role="tab"], .view-btn')]
          .map((b) => b.textContent.trim())
          .filter(Boolean)
      )]
    )
    for (const view of views.length ? views : ['(default)']) {
      if (view !== '(default)') {
        const btn = page.getByRole('button', { name: view, exact: true }).first()
        if (!(await btn.count())) continue
        await btn.click({ timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(700)
      }
      for (const [kind, probe] of [
        ['hidden-label', PROBE_HIDDEN_LABEL],
        ['label-overlap', PROBE_LABEL_OVERLAP],
      ]) {
        for (const hit of await page.evaluate(probe)) {
          findings.push({ repo, view, kind, detail: hit.text ?? hit.row, cls: hit.cls })
        }
      }
    }
  } catch (err) {
    findings.push({ repo, view: '-', kind: 'error', detail: err.message })
  }

  await page.close()
  vite.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 1200))
  if (!JSON_OUT) console.log(`${repo}: ${findings.filter((f) => f.repo === repo).length} finding(s)`)
}

await browser.close()

if (JSON_OUT) {
  console.log(JSON.stringify({ width: WIDTH, checked: repos.length, findings }, null, 2))
} else if (!findings.length) {
  console.log(`\nNo hidden labels and no label collisions at ${WIDTH}px across ${repos.length} repos.`)
} else {
  console.log(`\n${findings.length} finding(s) at ${WIDTH}px:`)
  for (const f of findings) console.log(`  ${f.repo} · ${f.view} · ${f.kind}: ${f.detail}`)
}
process.exitCode = findings.length ? 1 : 0
