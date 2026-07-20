// Timezone + formatting core.
//
// Every game's `tip` is an absolute instant (UTC ISO string), so rendering into any
// IANA zone is a pure formatting concern — no date math, no DST edge cases.

export const detectTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
  } catch {
    return 'America/New_York'
  }
}

// The zones worth one tap. WNBA markets span US/Canada; the rest cover the
// international audience that follows players in the off-season.
export const TIMEZONES = [
  { id: 'America/New_York', label: 'Eastern' },
  { id: 'America/Chicago', label: 'Central' },
  { id: 'America/Denver', label: 'Mountain' },
  { id: 'America/Phoenix', label: 'Arizona' },
  { id: 'America/Los_Angeles', label: 'Pacific' },
  { id: 'America/Toronto', label: 'Toronto' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Paris', label: 'Central Europe' },
  { id: 'Australia/Sydney', label: 'Sydney' },
  { id: 'UTC', label: 'UTC' },
]

export function timezoneOptions(current) {
  const known = TIMEZONES.some((t) => t.id === current)
  return known ? TIMEZONES : [{ id: current, label: current.split('/').pop().replace(/_/g, ' ') }, ...TIMEZONES]
}

const fmt = (tz, opts) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts })

export function formatTime(iso, tz) {
  return fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

export function formatDate(iso, tz, opts = {}) {
  return fmt(tz, { weekday: 'short', month: 'short', day: 'numeric', ...opts }).format(new Date(iso))
}

export function formatZoneAbbr(iso, tz) {
  const parts = fmt(tz, { timeZoneName: 'short' }).formatToParts(new Date(iso))
  return parts.find((p) => p.type === 'timeZoneName')?.value || ''
}

// Stable YYYY-MM-DD key for the calendar day a game falls on *in the viewer's zone*.
// A 10pm Pacific tip is "today" out west and "tomorrow" on the east coast, and the
// schedule must group by what the viewer actually sees.
export function dayKey(iso, tz) {
  const p = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso))
  const get = (t) => p.find((x) => x.type === t).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export const todayKey = (tz, now = new Date()) => dayKey(now.toISOString(), tz)

export function dayLabel(key, tz, now = new Date()) {
  const today = todayKey(tz, now)
  if (key === today) return 'Today'
  const d = new Date(`${key}T12:00:00Z`)
  const shift = (n) => {
    const x = new Date(d)
    x.setUTCDate(x.getUTCDate() + n)
    return dayKey(x.toISOString(), 'UTC')
  }
  if (shift(-1) === today) return 'Tomorrow'
  if (shift(1) === today) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(d)
}

// A WNBA game runs ~2h; treat that as the window in which a game with no live feed
// should still be considered possibly in progress.
const GAME_MS = 2.25 * 60 * 60 * 1000

export function liveState(game, now = Date.now()) {
  if (game.postponed || game.canceled) return 'void'
  if (game.live) return 'live'
  if (game.score) return 'final'
  const start = new Date(game.tip).getTime()
  if (now < start) return 'upcoming'
  return now < start + GAME_MS ? 'likely-live' : 'past'
}

export function countdown(iso, now = Date.now()) {
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return null
  const mins = Math.floor(ms / 60000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}
