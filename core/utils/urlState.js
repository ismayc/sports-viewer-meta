// Query-string state.
//
// There's no router — `view` is a useState string — so the URL is kept in sync by
// hand. Only non-default values are written, which keeps a shared link readable:
//
//   ?view=stats&tz=America/Chicago&team=MIN&hide=1
//
// Writes use history.replaceState so changing a filter doesn't stack up back-button
// entries.

export const DEFAULTS = {
  view: 'schedule',
  tz: null, // no default — falls back to the detected zone
  team: '',
  hide: false,
  mine: false,
  past: false,
}

const VALID_VIEWS = ['schedule', 'week', 'standings', 'playoffs', 'radial', 'stats']

export function readState(search = window.location.search) {
  const p = new URLSearchParams(search)
  const view = p.get('view')
  const tz = p.get('tz')

  return {
    // An unknown view in a stale link should land on the schedule, not a blank page.
    view: VALID_VIEWS.includes(view) ? view : DEFAULTS.view,
    // Validated against the platform rather than a hard-coded list, so any IANA zone
    // in a shared link works.
    tz: isValidZone(tz) ? tz : null,
    team: p.get('team') || DEFAULTS.team,
    hide: p.get('hide') === '1',
    mine: p.get('mine') === '1',
    past: p.get('past') === '1',
  }
}

export function isValidZone(tz) {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function toSearch(state, detectedTz) {
  const p = new URLSearchParams()
  if (state.view && state.view !== DEFAULTS.view) p.set('view', state.view)
  // Only pin the timezone when it differs from what this device would pick anyway,
  // so a link shared between two people in the same zone stays clean.
  if (state.tz && state.tz !== detectedTz) p.set('tz', state.tz)
  if (state.team) p.set('team', state.team)
  if (state.hide) p.set('hide', '1')
  if (state.mine) p.set('mine', '1')
  if (state.past) p.set('past', '1')
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function writeState(state, detectedTz) {
  if (typeof window === 'undefined') return
  const next = `${window.location.pathname}${toSearch(state, detectedTz)}${window.location.hash}`
  window.history.replaceState(null, '', next)
}
