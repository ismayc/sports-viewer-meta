// Rehearsal-only vitest setup file: move the suite's idea of "now" to the instant
// in SIM_NOW, leaving the committed data exactly as it is on disk.
//
// WHY IT IS SEPARATE FROM THE DATA. Every viewer in this family reads two moving
// things: a committed snapshot that a refresh workflow rewrites several times a
// day, and Date.now(). Freezing the snapshot into a fixture fixes the first and
// does nothing about the second, and the second breaks tests on days when nobody
// commits anything. See scripts/rehearse-clock.mjs for the runner and
// docs/PLAYBOOK.md §6 for the incidents.
//
// LOAD ORDER MATTERS. This file goes BEFORE the repo's own test/setup.js. Vitest's
// fake timers capture whatever globalThis.Date is at install time and restore it on
// useRealTimers(), so installing first means a test's own vi.useRealTimers() falls
// back to the rehearsal clock rather than to the real one. Installed after, half
// the suite would quietly slip back to today.
//
// ONLY Date IS REPLACED. setTimeout, setInterval and friends are untouched, so
// @testing-library's waitFor, userEvent's internal timers and any polling test keep
// working. A test that wants full fake timers still installs them itself.
const AT = new Date(process.env.SIM_NOW).getTime()

if (Number.isNaN(AT)) {
  throw new Error(
    `clock-shim: SIM_NOW is not a date I can parse (got ${JSON.stringify(process.env.SIM_NOW)})`,
  )
}

const RealDate = globalThis.Date

class SimDate extends RealDate {
  constructor(...args) {
    // `new Date()` means "now", which is the whole point of this file. Every other
    // form (ISO string, epoch ms, y/m/d parts, copy construction) has to behave
    // exactly as before, or fixtures with explicit dates would move too.
    if (args.length === 0) super(AT)
    else super(...args)
  }

  static now() {
    return AT
  }
}

globalThis.Date = SimDate
