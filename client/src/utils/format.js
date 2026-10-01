// Display formatting. The API sends money as integer micro-dollars and share
// quantities as micro-shares; they become dollars only here, for display.
const MICRO = 1_000_000

/**
 * "$1,081.40"; with `whole`, "$1,081".
 * @param {number | null | undefined} micro
 * @param {{ whole?: boolean }} [options]
 */
export function usd(micro, { whole = false } = {}) {
  if (micro === null || micro === undefined) return '—'
  const digits = whole ? 0 : 2
  const n = micro / MICRO
  const text = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${n < 0 ? '−' : ''}$${text}`
}

/**
 * "0.351" shares: up to three decimals, trailing zeros dropped.
 * @param {number} micro
 */
export const shares = (micro) => (micro / MICRO).toLocaleString('en-US', { maximumFractionDigits: 3 })

/**
 * A signed percentage, "+8.1%" or "−1.8%"; zero is "0.0%".
 * @param {number | null | undefined} pct
 * @param {number} [digits]
 */
export function signedPct(pct, digits = 1) {
  if (pct === null || pct === undefined) return '—'
  const rounded = Number(pct.toFixed(digits))
  if (rounded === 0) return `${(0).toFixed(digits)}%`
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(digits)}%`
}

/**
 * A plain percentage, "40%".
 * @param {number | null | undefined} pct
 */
export const pct = (pct) => (pct === null || pct === undefined ? '—' : `${Math.round(pct)}%`)

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A trading date as people say it: "Fri 27 Nov". Trading dates are plain
 * calendar days, so this reads them without any time zone.
 * @param {string | null | undefined} date 'YYYY-MM-DD'
 * @param {{ weekday?: boolean, year?: boolean }} [options]
 */
export function day(date, { weekday = true, year = false } = {}) {
  if (!date) return '—'
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${weekday ? `${WEEKDAYS[dow]} ` : ''}${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ''}`
}

/**
 * "23–27 Nov", or "30 Nov–4 Dec" across months.
 * @param {string} start
 * @param {string} end
 */
export function dayRange(start, end) {
  if (start === end) return day(start, { weekday: false })
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  return `${sameMonth ? Number(start.slice(8)) : day(start, { weekday: false })}–${day(end, { weekday: false })}`
}

/**
 * "November 2026" for a month's last trading day.
 * @param {string} date
 */
export const monthName = (date) => new Date(`${date.slice(0, 7)}-01T12:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
