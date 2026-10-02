import { describe, it, expect } from 'vitest'
import { marketWhen } from '../../src/components/MarketStatus.js'

describe('market status wording', () => {
  // Friday 27 November 2026, a half day: the close is 13:00 in New York.
  it('says when an open market closes, in New York time', () => {
    expect(marketWhen('open', '2026-11-27T18:00:00.000Z', 0)).toBe('closes 13:00 NY')
  })

  it('counts down the hour before the open', () => {
    expect(marketWhen('soon', '2026-11-27T14:30:00.000Z', Date.parse('2026-11-27T13:48:00Z'))).toBe('opens in 42 min')
  })

  it('names the next open when closed, and says so on a holiday', () => {
    expect(marketWhen('closed', '2026-11-30T14:30:00.000Z', 0)).toBe('opens Mon 09:30 NY')
    expect(marketWhen('holiday', '2026-11-27T14:30:00.000Z', 0)).toBe('holiday · opens Fri 09:30 NY')
  })
})
