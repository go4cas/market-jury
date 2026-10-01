import { describe, expect, test } from 'bun:test'
import { toMicro, fromMicro, percentChange } from '../core/money.js'

describe('money', () => {
  test('stores dollars as whole micro-dollars without float drift', () => {
    expect(toMicro(512.4)).toBe(512_400_000)
    expect(toMicro(0.1 + 0.2)).toBe(300_000)
    expect(toMicro(1000)).toBe(1_000_000_000)
  })

  test('converts back for display', () => {
    expect(fromMicro(1_081_200_000)).toBe(1081.2)
  })

  test('percent change to one decimal, null when there is nothing to compare', () => {
    expect(percentChange(110_000_000, 100_000_000)).toBe(10)
    expect(percentChange(96_660_000, 100_000_000)).toBe(-3.3)
    expect(percentChange(100_000_000, null)).toBeNull()
    expect(percentChange(100_000_000, 0)).toBeNull()
  })
})
