// Timezone + formatting core.
//
// Every game's `tip` is an absolute instant (UTC ISO string), so rendering into any
// IANA zone is a pure formatting concern — no date math, no DST edge cases.
//
// Locale and week-start come from the adapter, not from hardcoding: build the app's
// utils once with createTimeUtils(adapter) and use those. en-US gives "7:00 PM",
// en-GB gives "19:00" — Intl derives the hour cycle from the locale, so there is no
// separate 12/24h switch. The bare exports at the bottom are the en-US / Sunday-start
// defaults, kept so code copied from earlier builds still runs — new code should use
// the factory.

export const detectTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
  } catch {
    return 'America/New_York'
  }
}

// The zones worth one tap. US-league markets span US/Canada; the rest cover the
// international audience that follows players in the off-season. An adapter can
// hand createTimeUtils its own list (EPL wants UK/Europe first).
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

export function createTimeUtils(adapter = {}) {
  const locale = adapter.locale || 'en-US'
  const weekStart = adapter.weekStart ?? 0 // 0 = Sunday (US), 1 = Monday (football)
  const gameLengthMs = adapter.gameLengthMs ?? 2.25 * 60 * 60 * 1000
  const zones = adapter.timezones || TIMEZONES

  const fmt = (tz, opts) => new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts })

  function timezoneOptions(current) {
    const known = zones.some((t) => t.id === current)
    return known
      ? zones
      : [{ id: current, label: current.split('/').pop().replace(/_/g, ' ') }, ...zones]
  }

  function formatTime(iso, tz) {
    return fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  }

  function formatDate(iso, tz, opts = {}) {
    return fmt(tz, { weekday: 'short', month: 'short', day: 'numeric', ...opts }).format(
      new Date(iso)
    )
  }

  function formatZoneAbbr(iso, tz) {
    const parts = fmt(tz, { timeZoneName: 'short' }).formatToParts(new Date(iso))
    return parts.find((p) => p.type === 'timeZoneName')?.value || ''
  }

  // Stable YYYY-MM-DD key for the calendar day a game falls on *in the viewer's zone*.
  // A 10pm Pacific tip is "today" out west and "tomorrow" on the east coast, and the
  // schedule must group by what the viewer actually sees. (Numeric parts, so the key
  // is locale-independent — only the labels below vary.)
  function dayKey(iso, tz) {
    const p = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
      new Date(iso)
    )
    const get = (t) => p.find((x) => x.type === t).value
    return `${get('year')}-${get('month')}-${get('day')}`
  }

  const todayKey = (tz, now = new Date()) => dayKey(now.toISOString(), tz)

  function dayLabel(key, tz, now = new Date()) {
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
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(d)
  }

  // YYYY-MM-DD of the week the game falls in, per the adapter's week start — the
  // Sunday-vs-Monday split every earlier build hardcoded for itself.
  function startOfWeek(iso, tz) {
    const key = dayKey(iso, tz)
    const d = new Date(`${key}T12:00:00Z`)
    const dow = (d.getUTCDay() - weekStart + 7) % 7
    d.setUTCDate(d.getUTCDate() - dow)
    return d.toISOString().slice(0, 10)
  }

  function liveState(game, now = Date.now()) {
    if (game.postponed || game.canceled) return 'void'
    if (game.live) return 'live'
    if (game.score) return 'final'
    const start = new Date(game.tip).getTime()
    if (now < start) return 'upcoming'
    return now < start + gameLengthMs ? 'likely-live' : 'past'
  }

  function countdown(iso, now = Date.now()) {
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

  return {
    locale,
    weekStart,
    timezoneOptions,
    formatTime,
    formatDate,
    formatZoneAbbr,
    dayKey,
    todayKey,
    dayLabel,
    startOfWeek,
    liveState,
    countdown,
  }
}

// en-US / Sunday-start defaults, for code copied from builds that predate the factory.
const defaults = createTimeUtils()
export const timezoneOptions = defaults.timezoneOptions
export const formatTime = defaults.formatTime
export const formatDate = defaults.formatDate
export const formatZoneAbbr = defaults.formatZoneAbbr
export const dayKey = defaults.dayKey
export const todayKey = defaults.todayKey
export const dayLabel = defaults.dayLabel
export const startOfWeek = defaults.startOfWeek
export const liveState = defaults.liveState
export const countdown = defaults.countdown
