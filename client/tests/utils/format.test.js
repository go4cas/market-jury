import { describe, expect, it } from 'vitest'
import { day, dayRange, monthName, pct, shares, signedPct, usd } from '../../src/utils/format.js'
import { alignHistories } from '../../src/utils/series.js'
import { displayName, markOf, modelName } from '../../src/utils/traders.js'

describe('format', () => {
  it('shows micro-dollars as dollars', () => {
    expect(usd(1_081_400_000)).toBe('$1,081.40')
    expect(usd(1_081_400_000, { whole: true })).toBe('$1,081')
    expect(usd(-2_500_000)).toBe('−$2.50')
    expect(usd(null)).toBe('—')
  })

  it('shows shares to three decimals and percentages with a sign', () => {
    expect(shares(351_234)).toBe('0.351')
    expect(signedPct(8.14)).toBe('+8.1%')
    expect(signedPct(-1.8)).toBe('−1.8%')
    expect(signedPct(0.01)).toBe('0.0%')
    expect(pct(39.6)).toBe('40%')
  })

  it('reads trading dates as plain calendar days', () => {
    expect(day('2026-11-27')).toBe('Fri 27 Nov')
    expect(day('2026-11-27', { weekday: false, year: true })).toBe('27 Nov 2026')
    expect(dayRange('2026-11-23', '2026-11-27')).toBe('23–27 Nov')
    expect(dayRange('2026-11-30', '2026-12-04')).toBe('30 Nov–4 Dec')
    expect(monthName('2026-11-30')).toBe('November 2026')
  })
})

describe('traders', () => {
  it('names and marks a Trader', () => {
    expect(displayName('Claude daily')).toBe('Claude · Daily')
    expect(displayName('The Index')).toBe('The Index')
    expect(modelName('DeepSeek weekly')).toBe('DeepSeek')
    expect(markOf({ name: 'Gemini weekly', kind: 'ai' })).toBe('GE')
    expect(markOf({ name: 'The Index', kind: 'benchmark' })).toBe('SPY')
    expect(markOf({ name: 'Mistral daily', kind: 'ai' })).toBe('MI')
  })

  it('lines up value histories on shared dates', () => {
    const { dates, lines } = alignHistories([
      { name: 'A daily', kind: 'ai', colourSlot: 1, values: [{ date: '2026-11-23', totalMicro: 1 }, { date: '2026-11-24', totalMicro: 2 }] },
      { name: 'The Index', kind: 'benchmark', colourSlot: null, values: [{ date: '2026-11-24', totalMicro: 3 }] },
    ])
    expect(dates).toEqual(['2026-11-23', '2026-11-24'])
    expect(lines.map((l) => l.values)).toEqual([[1, 2], [null, 3]])
  })
})
