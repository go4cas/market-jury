// Market Jury shows each reader their own time, and New York time where the market matters.
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

/** The viewer's own time zone, as the browser reports it ("Australia/Sydney"). */
export const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

// Short zone names depend on the locale (only en-ZA says "SAST", only en-AU says
// "AEDT"), so ask a few English locales and keep the first real abbreviation.
const ZONE_LOCALES = ['en-ZA', 'en-AU', 'en-NZ', 'en-GB', 'en-US', 'en-IN', 'en-CA']

/**
 * "SAST", "AEDT", "EDT"; "GMT+5" where no English locale has a name for the zone.
 * @param {Date} date the moment (summer and winter names differ)
 * @param {string} timeZone
 */
export function zoneLabel(date, timeZone) {
  /** @param {string} locale */
  const name = (locale) => new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? ''
  const names = ZONE_LOCALES.map(name)
  return names.find((n) => /^[A-Z]{2,5}$/.test(n) && n !== 'GMT') ?? names.find((n) => n === 'GMT') ?? names[0]
}
