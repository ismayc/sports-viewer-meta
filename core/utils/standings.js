// Standings for every league shape, driven by the adapter's `standingsModel`.
//
//   winloss     W-L,   ranked by win%, gamesBehind        NBA, WNBA
//   winlosstie  W-L-T, a tie counts as half a win         NFL
//   points      W-D-L, 3/1/0, ranked pts → GD → GF        EPL, World Cup groups
//
// Pure: a function of the merged game list, so it can be unit-tested with synthetic
// arrays and can never disagree with the fixtures on screen mid-poll.

const RESULT = { HOME: 'home', AWAY: 'away', DRAW: 'draw' }

const outcome = (g) => {
  const [h, a] = g.score
  if (h === a) return RESULT.DRAW
  return h > a ? RESULT.HOME : RESULT.AWAY
}

/**
 * Which games count. Every league has at least one game in its feed that should not:
 * an exhibition, a cup final, a postponed shell that also has a makeup fixture.
 * `isCountable` is supplied per league so this stays honest.
 */
export const defaultCountable = (g) =>
  !!g.score && !g.postponed && !g.canceled && g.seasonType !== 'exhibition'

const blank = (abbr) => ({
  abbr,
  w: 0,
  l: 0,
  t: 0,
  pf: 0,
  pa: 0,
  home: { w: 0, l: 0, t: 0 },
  away: { w: 0, l: 0, t: 0 },
  group: { w: 0, l: 0, t: 0 },
  results: [],
})

export function computeStandings(games, adapter, { isCountable = defaultCountable } = {}) {
  const { standingsModel, winPoints = 3, drawPoints = 1, groupByTeam } = adapter
  const allowsDraw = standingsModel !== 'winloss'

  const table = {}
  const row = (abbr) => (table[abbr] ??= blank(abbr))

  const played = games.filter(isCountable).sort((a, b) => a.tip.localeCompare(b.tip))

  for (const g of played) {
    const [hs, as] = g.score
    const res = outcome(g)

    for (const [abbr, side, mine, theirs, oppAbbr] of [
      [g.home, 'home', hs, as, g.away],
      [g.away, 'away', as, hs, g.home],
    ]) {
      const r = row(abbr)
      const won = res === (side === 'home' ? RESULT.HOME : RESULT.AWAY)
      const drew = allowsDraw && res === RESULT.DRAW
      const key = drew ? 't' : won ? 'w' : 'l'

      r[key]++
      r[side][key]++
      r.pf += mine
      r.pa += theirs
      if (groupByTeam && groupByTeam[oppAbbr] === groupByTeam[abbr]) r.group[key]++
      r.results.push({ id: g.id, won, drew, opp: oppAbbr, side, pf: mine, pa: theirs, tip: g.tip })
    }
  }

  for (const r of Object.values(table)) {
    r.gp = r.w + r.l + r.t
    r.diff = r.pf - r.pa
    r.pfpg = r.gp ? r.pf / r.gp : 0
    r.papg = r.gp ? r.pa / r.gp : 0
    r.netpg = r.pfpg - r.papg

    // A tie is half a win — the standard treatment in every W-L-T league.
    r.pct = r.gp ? (r.w + r.t / 2) / r.gp : 0
    r.points = r.w * winPoints + r.t * drawPoints

    r.form = r.results.slice(-5).map((x) => (x.drew ? 'D' : x.won ? 'W' : 'L'))
    r.last10 = r.results.slice(-10).map((x) => x.won)
    r.streak = streakOf(r.results)
  }

  return table
}

// Positive = win streak, negative = loss streak, 0 = none or a draw most recently.
function streakOf(results) {
  if (!results.length) return 0
  const last = results[results.length - 1]
  if (last.drew) return 0
  let n = 0
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].drew || results[i].won !== last.won) break
    n++
  }
  return last.won ? n : -n
}

// ── Ranking ──────────────────────────────────────────────────────────────────

export function headToHead(games, a, b, isCountable = defaultCountable) {
  let aw = 0
  let bw = 0
  for (const g of games) {
    if (!isCountable(g)) continue
    if (![g.home, g.away].includes(a) || ![g.home, g.away].includes(b)) continue
    const res = outcome(g)
    if (res === RESULT.DRAW) continue
    const winner = res === RESULT.HOME ? g.home : g.away
    winner === a ? aw++ : bw++
  }
  return aw || bw ? { aw, bw } : null
}

const TIEBREAKERS = {
  headToHead: (a, b, ctx) => {
    const h = headToHead(ctx.games, a.abbr, b.abbr, ctx.isCountable)
    return h ? h.bw - h.aw : 0
  },
  pointDiff: (a, b) => b.diff - a.diff,
  goalDiff: (a, b) => b.diff - a.diff,
  goalsFor: (a, b) => b.pf - a.pf,
  winPctVsWinning: (a, b, ctx) => {
    const vs = (r) => {
      const rel = r.results.filter((x) => (ctx.table[x.opp]?.pct ?? 0) >= 0.5)
      return rel.length ? rel.filter((x) => x.won).length / rel.length : 0
    }
    return vs(b) - vs(a)
  },
}

function primary(model) {
  // Points leagues rank on points; win/loss leagues rank on win percentage.
  return model === 'points' ? (a, b) => b.points - a.points : (a, b) => b.pct - a.pct
}

export function rankTeams(games, adapter, opts = {}) {
  const { isCountable = defaultCountable } = opts
  const table = opts.table || computeStandings(games, adapter, { isCountable })
  const ctx = { games, table, isCountable }
  const first = primary(adapter.standingsModel)

  const rows = Object.values(table).sort((a, b) => {
    const p = first(a, b)
    if (p) return p
    for (const name of adapter.tiebreakers || []) {
      const cmp = TIEBREAKERS[name]?.(a, b, ctx) ?? 0
      if (cmp) return cmp
    }
    // Deterministic last resort — without this the order shuffles between renders.
    return a.abbr.localeCompare(b.abbr)
  })

  // Competition ranking: ties share a position and consume the slots below (1,2,2,4).
  const keyOf = (r) =>
    adapter.standingsModel === 'points' ? `${r.points}:${r.diff}:${r.pf}` : `${r.pct}`
  let pos = 0
  let prev = null
  rows.forEach((r, i) => {
    const k = keyOf(r)
    if (k !== prev) {
      pos = i + 1
      prev = k
    }
    r.pos = pos
    r.rank = i + 1
  })

  const leader = rows[0]
  for (const r of rows) r.gb = leader ? gamesBehind(leader, r) : 0

  return rows
}

/** Standard games-behind: (Δwins + Δlosses) / 2. Meaningless in a points league. */
export const gamesBehind = (leader, row) => (leader.w - row.w + (row.l - leader.l)) / 2

export function byGroup(games, adapter, opts = {}) {
  const ranked = rankTeams(games, adapter, opts)
  if (!adapter.groupByTeam) return { all: ranked }
  const out = {}
  for (const r of ranked) {
    const g = adapter.groupByTeam[r.abbr] || 'all'
    ;(out[g] ??= []).push(r)
  }
  // Re-rank within each group so positions read 1..n per conference.
  for (const list of Object.values(out)) list.forEach((r, i) => (r.groupPos = i + 1))
  return out
}
