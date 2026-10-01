// Market Jury shows South African time to its reader and New York time for the market.
export const SA_TIME_ZONE = 'Africa/Johannesburg'
export const NY_TIME_ZONE = 'America/New_York'

/**
 * "15:41" in the given time zone.
 * @param {Date} date
 * @param {string} timeZone
 */
export function formatClock(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

/**
 * "Wed 14 Oct 2026" in the given time zone.
 * @param {Date} date
 * @param {string} timeZone
 */
export function formatDateline(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(date)
  /** @param {string} type */
  const part = (type) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`
}
