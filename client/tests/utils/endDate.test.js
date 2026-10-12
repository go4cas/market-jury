import { describe, expect, it } from 'vitest'
import { checkEnd, endHint, firstChoice, quickPicks } from '../../src/utils/endDate.js'

// Weekdays from Tue 6 Oct 2026 (day one), skipping Thanksgiving and Christmas.
const days = []
for (let d = new Date('2026-10-06T12:00:00Z'); days.length < 70; d.setUTCDate(d.getUTCDate() + 1)) {
  const iso = d.toISOString().slice(0, 10)
  if (d.getUTCDay() % 6 && iso !== '2026-11-26' && iso !== '2026-12-25') days.push(iso)
}
const info = { today: '2026-10-12', endDate: days[62], endDay: 63, paperPhaseDays: 63, tradingDays: days }

describe('the last trading day', () => {
  it('offers quick picks by trading day, leaving out any that have passed', () => {
    expect(quickPicks(info)).toEqual([{ label: '6 weeks', date: days[29] }, { label: '8 weeks', date: days[39] }, { label: '3 months', date: days[62] }])
    expect(quickPicks({ ...info, today: days[35] }).map((p) => p.label)).toEqual(['8 weeks', '3 months'])
    expect(firstChoice(info)).toBe('2026-10-13')
  })

  it('takes only a trading day after today, and counts it', () => {
    expect(checkEnd(info, '2026-10-12')).toEqual({ ok: false, error: 'Pick a trading day after today.' })
    expect(checkEnd(info, '')).toEqual({ ok: false, error: 'Pick a trading day after today.' })
    expect(checkEnd(info, '2026-11-14')).toEqual({ ok: false, error: 'Markets are closed on Sat 14 Nov. Pick a trading day.' })
    expect(checkEnd(info, '2026-11-26')).toEqual({ ok: false, error: 'Markets are closed on Thu 26 Nov. Pick a trading day.' })
    expect(checkEnd(info, '2028-01-03').ok).toBe(false)
    const c = checkEnd(info, days[29])
    expect(c).toEqual({ ok: true, date: days[29], day: 30, weeks: 6, fromToday: 25 })
    if (c.ok) expect(endHint(c)).toBe('Day 30 · 6 weeks of trading · 25 trading days from today')
    const next = checkEnd(info, '2026-10-13')
    if (next.ok) expect(endHint(next)).toBe('Day 6 · 1 week of trading · 1 trading day from today')
  })
})
