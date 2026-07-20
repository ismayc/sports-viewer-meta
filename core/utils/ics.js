// iCalendar (RFC 5545) export.
//
// Games carry an absolute instant, so every event is emitted in UTC with a trailing Z
// and the calendar app renders it in the subscriber's own zone. No VTIMEZONE needed.

import { TEAM_BY_ABBR } from '../data/teams.js'

// A WNBA game runs about two hours.
const DURATION = 'PT2H30M'
const PRODID = '-//the-wnba-schedule//EN'

// Backslash, semicolon, and comma are delimiters in RFC 5545 and must be escaped;
// newlines become the literal two-character sequence \n.
export const escapeText = (s = '') =>
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')

export const toIcsDate = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

// RFC 5545 caps a line at 75 octets; continuations start with a single space.
// Measured in UTF-8 bytes, not characters, so team names with accents don't break it.
export function fold(line) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line

  const out = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // Don't split a multi-byte character: back off to a lead byte.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    out.push(new TextDecoder().decode(bytes.slice(start, end)))
    start = end
    limit = 74 // continuation lines lose one octet to the leading space
  }
  return out.join('\r\n ')
}

function vevent(game, { now }) {
  const home = TEAM_BY_ABBR[game.home]
  const away = TEAM_BY_ABBR[game.away]

  const title = `${away?.displayName || game.away} at ${home?.displayName || game.home}`
  const summary = game.score
    ? `${title} (${game.score[1]}–${game.score[0]})`
    : title

  const where = [game.venue, game.city, game.state].filter(Boolean).join(', ')
  const desc = [
    game.broadcast?.length ? `Watch: ${game.broadcast.join(', ')}` : null,
    game.note || null,
    game.round ? `Playoffs — ${game.round}${game.game ? ` game ${game.game}` : ''}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const lines = [
    'BEGIN:VEVENT',
    // Stable UID so re-importing updates events rather than duplicating them.
    `UID:${game.id}@the-wnba-schedule`,
    `DTSTAMP:${toIcsDate(now)}`,
    `DTSTART:${toIcsDate(game.tip)}`,
    `DURATION:${DURATION}`,
    `SUMMARY:${escapeText(summary)}`,
  ]
  if (where) lines.push(`LOCATION:${escapeText(where)}`)
  if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`)
  // A postponed game keeps its slot in the feed; mark it rather than dropping it, so
  // an existing subscription gets the cancellation.
  if (game.postponed || game.canceled) lines.push('STATUS:CANCELLED')
  lines.push('END:VEVENT')
  return lines
}

export function buildIcs(games, { name = 'WNBA', now = new Date().toISOString() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    ...games.flatMap((g) => vevent(g, { now })),
    'END:VCALENDAR',
  ]
  // CRLF line endings are required by the spec, and some clients reject LF-only.
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function downloadIcs(games, { filename = 'wnba.ics', name } = {}) {
  const blob = new Blob([buildIcs(games, { name })], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
