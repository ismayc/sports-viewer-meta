#!/usr/bin/env node
// Render every viewer at phone width in a real browser and report the labels
// that vanish or collide. Runs weekly in CI (.github/workflows/scan-mobile.yml,
// one job per repo, one issue when anything is found) and locally on demand.
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
// CHROME_PATH overrides the browser binary (the macOS Google Chrome is the default;
// the GitHub ubuntu runner has /usr/bin/google-chrome).
//
// EXIT CODE. 0 only when every repo started, at least one view was clicked and
// probed in each, and nothing was found. Any finding, any repo that failed to
// start, any repo that visited zero views, and a --repo that matches nothing all
// exit 1 (or 2 for setup problems), so a broken scan cannot pass as a clean one.
// An earlier DOM sweep in this family clicked nothing in eight repos and reported
// a confident zero, which is why each repo's visited views are printed below.
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
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const args = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i > -1 ? args[i + 1] : fallback
}
const JSON_OUT = args.includes('--json')
const WIDTH = Number(argOf('--width', 390))
const PORT = Number(argOf('--port', 5399))
const ONLY = argOf('--repo', null)
// Optional directory for one full-page screenshot per visited view.
const SHOTS = argOf('--shots', null)

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

if (!repos.length) {
  console.error(`No repo to scan under ${FAMILY}${ONLY ? ` matching --repo ${ONLY}` : ''}.`)
  console.error('Each app must sit beside the meta repo and have package.json and src/.')
  process.exit(2)
}

// The first CI run (September 29, 2026) hung all thirteen jobs for over half an hour.
// Each reported "vite did not start in 60s" and then never exited, for two reasons
// fixed here. Readiness was read from vite's stdout ("Local:"), which never matched on
// the runner, so readiness is now an HTTP answer from the server itself. And the failed
// server was never stopped: it was started through npx, so a kill reached npx and not
// vite, and the live child kept Node running. vite now starts from the app's own
// node_modules/.bin, on 127.0.0.1 so the address cannot resolve to IPv6 instead, and is
// killed on every path. The last lines it printed go into the error.
const HOST = '127.0.0.1'
const START_MS = Number(process.env.SCAN_VITE_TIMEOUT_MS ?? 120000)

// Something already answering on the port (a dev server left running, another tool)
// would be mistaken for this repo's app, so a busy port is an error before vite starts.
const portAnswers = async () => {
  try {
    await fetch(`http://${HOST}:${PORT}/`)
    return true
  } catch {
    return false
  }
}

const startVite = async (repo) => {
  if (await portAnswers()) throw new Error(`port ${PORT} is already answering; stop whatever holds it, or pass --port`)
  return launchVite(repo)
}

const launchVite = (repo) =>
  new Promise((ok, no) => {
    const bin = join(FAMILY, repo, 'node_modules', '.bin', 'vite')
    if (!existsSync(bin)) return no(new Error(`no ${bin}; run npm ci in ${repo} first`))
    const p = spawn(bin, ['--host', HOST, '--port', String(PORT), '--strictPort'], {
      cwd: join(FAMILY, repo),
      env: { ...process.env, BROWSER: 'none' },
    })
    let tail = ''
    const keep = (d) => (tail = (tail + String(d)).slice(-600))
    p.stdout.on('data', keep)
    p.stderr.on('data', keep)
    let settled = false
    const fail = (msg) => {
      if (settled) return
      settled = true
      p.kill('SIGKILL')
      no(new Error(`${msg}; its last output: ${tail.replace(/\s+/g, ' ').trim().slice(-300) || '(none)'}`))
    }
    p.on('exit', (c) => fail(`vite exited ${c}`))
    const deadline = Date.now() + START_MS
    const poll = async () => {
      if (settled) return
      try {
        // Only this repo's dev server counts: its page loads /@vite/client. Anything
        // else answering on the port is a different server, and scanning it would
        // report a clean pass for a page that is not this app.
        const res = await fetch(`http://${HOST}:${PORT}/`)
        if (res.ok && (await res.text()).includes('/@vite/client')) {
          settled = true
          return ok(p)
        }
      } catch {
        // Not listening yet.
      }
      if (Date.now() > deadline) return fail(`vite did not answer in ${START_MS / 1000}s`)
      setTimeout(poll, 500)
    }
    poll()
  })

/**
 * A row that shows an image but whose every scrap of text is hidden. This is the
 * crest-only row: it reads as identified until the crest is missing too.
 */
const PROBE_HIDDEN_LABEL = () => {
  const out = []
  // Content of a CLOSED <details> is hidden until the reader opens it, at every width:
  // that is a disclosure, not a label lost at phone width. The first CI run (September
  // 29, 2026) flagged all eight viewers on the hub's collapsed "Completed tournaments"
  // shelf this way. A closed details' own <summary> is still checked.
  const inClosedDisclosure = (el) => {
    const d = el.closest('details:not([open])')
    return Boolean(d) && !el.closest('summary')
  }
  for (const el of document.querySelectorAll('*')) {
    if (!el.querySelector('.logo, img')) continue
    if (inClosedDisclosure(el)) continue
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

// The three probes below were added November 2, 2026, after Chester found the NFL Playoffs
// bracket piled on itself at phone width: round headers printed over each other and match
// cards covered other cards. The two probes above could not see that, because no label was
// hidden and no margin bar was involved.

/** Text fragments that print on top of each other. Fixed and sticky chrome is exempt. */
const PROBE_TEXT_COLLISION = () => {
  const visible = (el) => {
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
  }
  const pinned = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const p = getComputedStyle(e).position
      if (p === 'fixed' || p === 'sticky') return true
    }
    return false
  }
  const frags = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.trim()
    const el = n.parentElement
    if (!text || !el || !el.checkVisibility?.() || !visible(el) || pinned(el)) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    // Clip to every clipping ancestor. An ellipsized name's range rect still spans its
    // full unclipped width, and a screen-reader-only caption's sits over the table, and
    // neither prints there.
    let clip = { l: -Infinity, r: Infinity, t: -Infinity, b: Infinity }
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      const c = e.getBoundingClientRect()
      clip = { l: Math.max(clip.l, c.left), r: Math.min(clip.r, c.right), t: Math.max(clip.t, c.top), b: Math.min(clip.b, c.bottom) }
    }
    for (const r of range.getClientRects()) {
      const l = Math.max(r.left, clip.l)
      const rt = Math.min(r.right, clip.r)
      const t = Math.max(r.top, clip.t)
      const b = Math.min(r.bottom, clip.b)
      if (rt - l > 1 && b - t > 1) frags.push({ el, text, l, r: rt, t, b })
    }
  }
  frags.sort((a, b) => a.t - b.t)
  const out = []
  const seen = new Set()
  for (let i = 0; i < frags.length; i++) {
    const a = frags[i]
    for (let j = i + 1; j < frags.length && frags[j].t < a.b; j++) {
      const b = frags[j]
      if (a.el === b.el) continue
      // Line boxes pad glyphs, so only a real bite counts, not two rows that graze.
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l)
      const h = Math.min(a.b, b.b) - Math.max(a.t, b.t)
      if (w < 3 || h < Math.min(a.b - a.t, b.b - b.t) * 0.4) continue
      const key = `${a.text}|${b.text}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text: `"${a.text.slice(0, 24)}" over "${b.text.slice(0, 24)}"`, cls: String(a.el.className).slice(0, 40) })
    }
  }
  return out.slice(0, 12)
}

/**
 * A flex or grid item shoved outside its own parent: the mark of a container told to shrink
 * (min-width: 0) around content that cannot. A scroller that clips on purpose is not a fault
 * unless its own children overflow it while it is NOT scrollable.
 */
const PROBE_SPILL = () => {
  const out = []
  for (const parent of document.querySelectorAll('body *')) {
    if (!parent.checkVisibility?.() || !parent.children.length) continue
    const s = getComputedStyle(parent)
    if (s.display !== 'flex' && s.display !== 'grid') continue
    if (s.overflowX !== 'visible') continue
    if (s.flexWrap === 'wrap') continue
    const box = parent.getBoundingClientRect()
    if (box.width < 40) continue
    for (const c of parent.children) {
      if (!c.checkVisibility?.()) continue
      const cs = getComputedStyle(c)
      if (cs.position === 'absolute' || cs.position === 'fixed') continue
      const r = c.getBoundingClientRect()
      if (r.width < 1) continue
      if (r.right > box.right + 3 || r.left < box.left - 3) {
        out.push({ text: `.${String(c.className).slice(0, 30)} leaves .${String(parent.className).slice(0, 30)} by ${Math.round(Math.max(r.right - box.right, box.left - r.left))}px`, cls: String(parent.className).slice(0, 40) })
        break
      }
    }
  }
  const seen = new Set()
  return out.filter((o) => (seen.has(o.cls) ? false : seen.add(o.cls))).slice(0, 12)
}

/** Ellipsized text left too short to read ("Bi..." for Bills), and sideways page scroll. */
const PROBE_SQUEEZED = () => {
  const out = []
  const over = document.documentElement.scrollWidth - window.innerWidth
  if (over > 1) {
    // Name the widest element past the edge that no scroller contains, so the finding
    // says what to fix. Its parents are often past the edge only because of it.
    const scrolls = (e) => {
      for (let p = e.parentElement; p; p = p.parentElement) {
        if (p === document.body || p === document.documentElement) return false
        const x = getComputedStyle(p).overflowX
        if (x === 'auto' || x === 'scroll' || x === 'hidden') return true
      }
      return false
    }
    const past = [...document.querySelectorAll('body *')].filter((e) => {
      if (!e.checkVisibility?.() || scrolls(e)) return false
      return e.getBoundingClientRect().right > window.innerWidth + 1
    })
    const cause = past
      .filter((e) => !past.some((d) => d !== e && e.contains(d)))
      .slice(0, 3)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`)
    out.push({ text: `page scrolls sideways by ${over}px, past the edge: ${cause.join(', ')}`, cls: 'html' })
  }
  for (const el of document.querySelectorAll('body *')) {
    if (!el.checkVisibility?.() || el.children.length) continue
    const s = getComputedStyle(el)
    if (s.textOverflow !== 'ellipsis' || s.overflowX === 'visible') continue
    const text = el.textContent.trim()
    if (text.length < 4) continue
    const shown = el.clientWidth / el.scrollWidth
    if (el.scrollWidth > el.clientWidth + 1 && shown < 0.55) {
      out.push({ text: `"${text.slice(0, 24)}" shows ${Math.round(shown * 100)}%`, cls: String(el.className).slice(0, 40) })
    }
  }
  const seen = new Set()
  return out.filter((o) => (seen.has(o.text) ? false : seen.add(o.text))).slice(0, 12)
}

const POPUP = '[role="dialog"], .modal-wrap, .modal'
const POPUP_TRIGGERS = ['.game-card', '.match-card', '.week-cell', '.wkg-cell', '.card[role="button"]', '.bx-team', '.team-btn', '.lead-player', '.boot-player-btn', '.bx-match-open', '.bx-match', '.mm-team:not(.mm-tbd)']
const SUB_VIEW_SELECTOR ='.view-tools button, .seg button, .bx-round-tabs button, .mm-tabs button, .view [role="tab"]'
const SUB_VIEW_NAMES = (sel = '.view-tools button, .seg button, .bx-round-tabs button, .mm-tabs button, .view [role="tab"]') =>
  [...new Set([...document.querySelectorAll(sel)].map((b) => b.textContent.trim()).filter(Boolean))]

const findings = []
const visitedByRepo = {}
const skippedByRepo = {}

const probeView = async (page, repo, view) => {
  ;(visitedByRepo[repo] ??= []).push(view)
  for (const [kind, probe] of [
    ['hidden-label', PROBE_HIDDEN_LABEL],
    ['label-overlap', PROBE_LABEL_OVERLAP],
    ['text-collision', PROBE_TEXT_COLLISION],
    ['spill', PROBE_SPILL],
    ['squeezed', PROBE_SQUEEZED],
  ]) {
    for (const hit of await page.evaluate(probe)) {
      findings.push({ repo, view, kind, detail: hit.text ?? hit.row, cls: hit.cls })
    }
  }
  if (SHOTS) {
    const name = `${repo}__${view.replace(/[^a-z0-9]+/gi, '-')}__${WIDTH}.png`
    await page.screenshot({ path: join(SHOTS, name), fullPage: true })
  }
}

let browser
try {
  browser = await chromium.launch({ executablePath: CHROME, headless: true })
} catch (err) {
  console.error(`Could not launch Chrome at ${CHROME} (set CHROME_PATH to override):`)
  console.error(`  ${err.message.split('\n')[0]}`)
  process.exit(2)
}

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
    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'networkidle', timeout: 45000 })
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
    // Names on the view list that are really tabs inside a view. They get probed with
    // their parent open, and the top-level pass then skips them instead of failing.
    const subOnly = new Set(
      await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim()).filter(Boolean))
    )
    for (const view of views.length ? views : ['(default)']) {
      if (view !== '(default)') {
        if (!subOnly.has(view) && (visitedByRepo[repo] ?? []).some((v) => v.endsWith(`> ${view}`))) continue
        // The list above includes [role="tab"] (the bracket viewers' region tabs), so
        // look the name up as a button first and as a tab second.
        let btn = page.getByRole('button', { name: view, exact: true }).first()
        if (!(await btn.count())) btn = page.getByRole('tab', { name: view, exact: true }).first()
        if (!(await btn.count())) {
          // Sub-tabs of another view (the bracket viewers' regions) are listed from the
          // default view but gone once a sibling view is open. Not a fault, but printed
          // so a skipped view is visible; zero visited views still fails below.
          ;(skippedByRepo[repo] ??= []).push(view)
          continue
        }
        try {
          await btn.click({ timeout: 5000 })
        } catch (err) {
          findings.push({ repo, view, kind: 'error', detail: `click failed: ${err.message.split('\n')[0]}` })
          continue
        }
        await page.waitForTimeout(700)
      }
      await probeView(page, repo, view)
      // Sub-views: a History tab's own bracket or stats mode, a bracket's round or region
      // tabs. The scan used to visit only what showed on the default view, so it never
      // saw these unless a sibling list happened to include them.
      const subs = await page.evaluate(SUB_VIEW_NAMES)
      for (const sub of subs) {
        if (sub === view || views.includes(sub)) {
          // A name both lists hold (region tabs) is probed here, while its parent is open.
          if (sub === view || !subOnly.has(sub)) continue
        }
        const subBtn = page
          .locator(SUB_VIEW_SELECTOR)
          .filter({ hasText: new RegExp(`^\\s*${sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) })
          .first()
        if (!(await subBtn.count())) continue
        try {
          await subBtn.click({ timeout: 5000 })
        } catch (err) {
          findings.push({ repo, view: `${view} > ${sub}`, kind: 'error', detail: `click failed: ${err.message.split('\n')[0]}` })
          continue
        }
        await page.waitForTimeout(400)
        await probeView(page, repo, `${view} > ${sub}`)
        subOnly.delete(sub)
      }
    }
  } catch (err) {
    findings.push({ repo, view: '-', kind: 'error', detail: err.message })
  }

  // Pop-ups: open one game and one team or player panel from each view that offers them,
  // since their tables are often the widest thing a phone gets asked to show.
  for (const view of (visitedByRepo[repo] ?? []).filter((v) => !v.includes(' > ') && v !== '(default)')) {
    try {
      const tab = page.getByRole('button', { name: view, exact: true }).first()
      if (!(await tab.count())) continue
      await tab.click({ timeout: 3000 })
      await page.waitForTimeout(300)
      for (const sel of POPUP_TRIGGERS) {
        const trigger = page.locator(sel).first()
        if (!(await trigger.count()) || !(await trigger.isVisible())) continue
        await trigger.click({ timeout: 3000 })
        await page.waitForTimeout(400)
        if (await page.locator(POPUP).count()) {
          await probeView(page, repo, `${view} > pop-up (${sel})`)
          const close = page.locator('.modal-x, .modal-close, [role="dialog"] [aria-label*="lose" i]').first()
          if (await close.count()) await close.click({ timeout: 3000 })
          else await page.keyboard.press('Escape')
          await page.waitForTimeout(200)
          // One that will not close would block every later click, so start the page over.
          if (await page.locator(POPUP).count()) {
            await page.reload({ waitUntil: 'networkidle' })
            break
          }
        }
      }
    } catch (err) {
      const why = err.message.split('\n').filter((l) => /waiting for|intercepts/.test(l)).slice(0, 2).join(' | ')
      findings.push({ repo, view: `${view} > pop-up`, kind: 'error', detail: `${err.message.split('\n')[0]} ${why}`.slice(0, 260) })
      await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
    }
  }

  // Zero views probed is a failed scan, never a clean one.
  if (!visitedByRepo[repo]?.length && !findings.some((f) => f.repo === repo && f.kind === 'error')) {
    findings.push({ repo, view: '-', kind: 'error', detail: 'visited zero views' })
  }

  await page.close()
  // Wait for the exit, so the next repo's server finds the port free.
  await new Promise((r) => {
    vite.once('exit', r)
    vite.kill('SIGTERM')
    setTimeout(() => (vite.kill('SIGKILL'), r()), 5000)
  })
  if (!JSON_OUT) {
    const v = visitedByRepo[repo] ?? []
    const sk = skippedByRepo[repo] ?? []
    console.log(`${repo}: visited ${v.length} view(s) [${v.join(', ')}]${sk.length ? `, skipped ${sk.length} not present when clicked [${sk.join(', ')}]` : ''}: ${findings.filter((f) => f.repo === repo).length} finding(s)`)
  }
}

await browser.close()

if (JSON_OUT) {
  console.log(JSON.stringify({ width: WIDTH, checked: repos.length, visited: visitedByRepo, skipped: skippedByRepo, findings }, null, 2))
} else if (!findings.length) {
  console.log(`\nNo hidden labels and no label collisions at ${WIDTH}px across ${repos.length} repos.`)
} else {
  console.log(`\n${findings.length} finding(s) at ${WIDTH}px:`)
  for (const f of findings) console.log(`  ${f.repo} · ${f.view} · ${f.kind}: ${f.detail}`)
}
// exit(), not exitCode: a stray handle (a child that ignored its signal) must not keep a
// finished scan running until the job times out.
process.exit(findings.length ? 1 : 0)
