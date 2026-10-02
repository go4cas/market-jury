import { describe, it, expect } from 'vitest'
import { formatClock, formatDateline, howLong, NY_TIME_ZONE, SA_TIME_ZONE, viewerTimeZone, zoneLabel } from '../../src/utils/time.js'

describe('time formatting', () => {
  // 14 Oct 2026 13:41 UTC: New York is on summer time (UTC-4), South Africa is UTC+2.
  const summer = new Date('2026-10-14T13:41:00Z')
  // 14 Jan 2027 14:41 UTC: New York is on winter time (UTC-5).
  const winter = new Date('2027-01-14T14:41:00Z')

  it('shows the same moment in New York and South Africa', () => {
    expect(formatClock(summer, NY_TIME_ZONE)).toBe('09:41')
    expect(formatClock(summer, SA_TIME_ZONE)).toBe('15:41')
  })

  it('follows the US clock change; South Africa has none', () => {
    expect(formatClock(winter, NY_TIME_ZONE)).toBe('09:41')
    expect(formatClock(winter, SA_TIME_ZONE)).toBe('16:41')
  })

  it('writes the dateline the way the design does', () => {
    expect(formatDateline(summer, SA_TIME_ZONE)).toBe('Wed 14 Oct 2026')
  })

  it('uses the date in the given time zone', () => {
    const lateNight = new Date('2026-10-14T23:30:00Z')
    expect(formatDateline(lateNight, SA_TIME_ZONE)).toBe('Thu 15 Oct 2026')
    expect(formatDateline(lateNight, NY_TIME_ZONE)).toBe('Wed 14 Oct 2026')
  })

  it('names a time zone the way its readers know it', () => {
    expect(zoneLabel(summer, SA_TIME_ZONE)).toBe('SAST')
    expect(zoneLabel(summer, 'Australia/Sydney')).toBe('AEDT')
    expect(zoneLabel(winter, 'Europe/London')).toBe('GMT')
    // Zones without a common abbreviation fall back to the offset.
    expect(zoneLabel(summer, 'Asia/Tashkent')).toBe('GMT+5')
  })

  it('reads the viewer\'s own time zone from the browser', () => {
    expect(viewerTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('says how long something took, in plain minutes and seconds', () => {
    expect(howLong('2026-10-02T08:00:00Z', '2026-10-02T08:02:14Z')).toBe('2m 14s')
    expect(howLong('2026-10-02T08:00:00Z', '2026-10-02T08:00:42.600Z')).toBe('43s')
    expect(howLong('2026-10-02T08:00:00Z', '2026-10-02T08:05:00Z')).toBe('5m')
    expect(howLong('2026-10-02T08:00:00Z', '2026-10-02T09:12:30Z')).toBe('1h 12m')
    expect(howLong(null, '2026-10-02T08:05:00Z')).toBe('')
  })
})
