// Notable-moment detection.
//
// A soccer viewer can toast every goal — ~2.7 a match, each one genuinely notable.
// Toasting every basket would fire ~65 times a game, roughly every 35 seconds, which
// is noise rather than signal. So instead of "the score changed", this detects the
// moments that actually change how a game feels.
//
// Everything is derived by diffing two poll snapshots, so it needs no play-by-play
// feed. That constrains what's detectable: a lead change is only seen if the lead
// flipped BETWEEN polls, so a bucket that flips and flips back inside 30 seconds is
// invisible. That's an acceptable trade — those are exactly the flips not worth a
// notification.

// A one-possession margin in the final period.
const CLOSE_MARGIN = 5
const REGULATION_PERIODS = 4

const leaderOf = (g) => {
  if (!g?.score) return null
  const [h, a] = g.score
  if (h === a) return 'tie'
  return h > a ? g.home : g.away
}

const marginOf = (g) => (g?.score ? Math.abs(g.score[0] - g.score[1]) : null)

const isLate = (g) =>
  !!g?.live && (g.period ?? 0) >= REGULATION_PERIODS && marginOf(g) != null && marginOf(g) <= CLOSE_MARGIN

const byId = (games) => new Map(games.map((g) => [g.id, g]))

export const EVENT_KINDS = ['tipoff', 'lead-change', 'nailbiter', 'final']

/**
 * Diff two snapshots of the game list and return notable moments.
 * `prev` of null means first load — nothing is notable yet, because everything
 * would look like it just happened.
 */
export function detectEvents(prev, next, { teams = null } = {}) {
  if (!prev) return []

  const before = byId(prev)
  const events = []

  for (const g of next) {
    const was = before.get(g.id)
    if (!was) continue

    // Only surface games involving the teams the viewer follows, when filtering.
    if (teams?.size && !teams.has(g.home) && !teams.has(g.away)) continue
    if (g.postponed || g.canceled) continue

    // A finished game is reported as final and nothing else — a buzzer-beater that
    // both flips the lead and ends the game is one moment, not three.
    if (was.live && !g.live && g.score) {
      events.push({ id: g.id, kind: 'final', game: g, leader: leaderOf(g), margin: marginOf(g) })
      continue
    }

    if (!was.live && g.live) {
      events.push({ id: g.id, kind: 'tipoff', game: g })
      continue
    }

    if (!g.live) continue

    // Lead changes: only when the lead genuinely flipped between the same two
    // named teams. Going from tied to led is not a lead change.
    const from = leaderOf(was)
    const to = leaderOf(g)
    if (from && to && from !== 'tie' && to !== 'tie' && from !== to) {
      events.push({ id: g.id, kind: 'lead-change', game: g, leader: to, margin: marginOf(g) })
      continue
    }

    // Fire once, on entering the close-and-late state, not on every poll while it
    // holds — otherwise a tight fourth quarter alerts every 30 seconds.
    if (isLate(g) && !isLate(was)) {
      events.push({ id: g.id, kind: 'nailbiter', game: g, leader: to, margin: marginOf(g) })
    }
  }

  return events
}

// Stable key so the same moment isn't shown twice across re-renders.
export const eventKey = (e) =>
  `${e.id}:${e.kind}:${e.kind === 'lead-change' || e.kind === 'nailbiter' ? e.leader : ''}`
