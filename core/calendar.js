// The trading calendar: which days a market is open, and when. Dates are
// 'YYYY-MM-DD' in the market's own time zone; rows come from the trading_days
// table, which the Floor Runner fills from Alpaca's calendar.

/** @typedef {import('bun:sqlite').Database} Database */

export const NYSE = 'XNYS'
export const NEW_YORK = 'America/New_York'

/**
 * @typedef {object} TradingDayRow
 * @property {string} date
 * @property {string} open_time
 * @property {string} close_time
 * @property {number} early_close
 */

/**
 * @param {Database} db
 * @param {string} date
 * @param {string} [calendar]
 * @returns {TradingDayRow | null}
 */
export function tradingDay(db, date, calendar = NYSE) {
  return /** @type {TradingDayRow | null} */ (
    db.query('SELECT date, open_time, close_time, early_close FROM trading_days WHERE calendar = ? AND date = ?').get(calendar, date)
  )
}

/** @param {Database} db @param {string} date @param {string} [calendar] */
export const isTradingDay = (db, date, calendar = NYSE) => tradingDay(db, date, calendar) !== null

/**
 * @param {Database} db
 * @param {string} date
 * @param {string} [calendar]
 * @returns {string | null}
 */
export function previousTradingDay(db, date, calendar = NYSE) {
  const row = /** @type {{ date: string } | null} */ (
    db.query('SELECT date FROM trading_days WHERE calendar = ? AND date < ? ORDER BY date DESC LIMIT 1').get(calendar, date)
  )
  return row?.date ?? null
}

/**
 * @param {Database} db
 * @param {string} date
 * @param {string} [calendar]
 * @returns {string | null}
 */
export function nextTradingDay(db, date, calendar = NYSE) {
  const row = /** @type {{ date: string } | null} */ (
    db.query('SELECT date FROM trading_days WHERE calendar = ? AND date > ? ORDER BY date LIMIT 1').get(calendar, date)
  )
  return row?.date ?? null
}

/**
 * The trading day `n` trading days before `date` (`date` itself when n is 0).
 * Null when the calendar does not reach that far back.
 * @param {Database} db
 * @param {string} date
 * @param {number} n
 * @param {string} [calendar]
 * @returns {string | null}
 */
export function tradingDaysBack(db, date, n, calendar = NYSE) {
  const row = /** @type {{ date: string } | null} */ (
    db.query('SELECT date FROM trading_days WHERE calendar = ? AND date <= ? ORDER BY date DESC LIMIT 1 OFFSET ?').get(calendar, date, n)
  )
  return row?.date ?? null
}

/**
 * Trading days from `start` to `end`, both included.
 * @param {Database} db
 * @param {string} start
 * @param {string} end
 * @param {string} [calendar]
 * @returns {string[]}
 */
export function tradingDaysBetween(db, start, end, calendar = NYSE) {
  return db
    .query('SELECT date FROM trading_days WHERE calendar = ? AND date BETWEEN ? AND ? ORDER BY date')
    .values(calendar, start, end)
    .map(([d]) => String(d))
}

/**
 * Monday of the week holding `date`.
 * @param {string} date
 */
function mondayOf(date) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/**
 * Is `date` the last trading day of its week (so the weekly Traders run)?
 * @param {Database} db
 * @param {string} date
 * @param {string} [calendar]
 */
export function isLastTradingDayOfWeek(db, date, calendar = NYSE) {
  if (!isTradingDay(db, date, calendar)) return false
  const next = nextTradingDay(db, date, calendar)
  return next === null || mondayOf(next) !== mondayOf(date)
}

/**
 * @param {Database} db
 * @param {string} date
 * @param {string} [calendar]
 * @returns {string | null}
 */
export function firstTradingDayOfWeek(db, date, calendar = NYSE) {
  return tradingDaysBetween(db, mondayOf(date), date, calendar)[0] ?? null
}

/**
 * The UTC instant of a wall-clock time in a time zone, e.g. 16:00 in New York.
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} time 'HH:MM'
 * @param {string} timeZone
 */
export function zonedTimeToUtc(date, time, timeZone) {
  const wall = Date.parse(`${date}T${time}:00Z`)
  // Guess with the zone's offset at the wall time, then correct once for a DST edge.
  let instant = wall - offsetMs(wall, timeZone)
  instant = wall - offsetMs(instant, timeZone)
  return new Date(instant)
}

/**
 * The zone's offset from UTC at an instant, in milliseconds.
 * @param {number} instant
 * @param {string} timeZone
 */
function offsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** @param {Database} db @param {string} date @param {string} [calendar] */
export function openInstant(db, date, calendar = NYSE) {
  const day = tradingDay(db, date, calendar)
  return day ? zonedTimeToUtc(date, day.open_time, NEW_YORK) : null
}

/** @param {Database} db @param {string} date @param {string} [calendar] */
export function closeInstant(db, date, calendar = NYSE) {
  const day = tradingDay(db, date, calendar)
  return day ? zonedTimeToUtc(date, day.close_time, NEW_YORK) : null
}

/**
 * The New York calendar date of an instant.
 * @param {Date} instant
 */
export function marketDate(instant) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NEW_YORK, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
}
