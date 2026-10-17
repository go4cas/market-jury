import { describe, expect, test } from 'bun:test'
import { pickHeadlines } from '../market/briefingPack.js'

const after = new Date('2026-11-23T21:00:00Z')
const until = new Date('2026-11-24T21:00:00Z')
let nextId = 1
/** @param {string} at @param {string[]} tickers @param {string} [headline] */
const item = (at, tickers, headline = `News ${nextId}`) => ({ id: nextId++, publishedAt: at, source: 'benzinga', tickers, headline })

describe('choosing headlines for a pack', () => {
  test('keeps menu-ticker news and broad-market news, drops rating notes and off-menu chatter', () => {
    const picked = pickHeadlines([
      item('2026-11-24T20:00:00Z', ['AAPL'], 'Apple shares rise after launch'),
      item('2026-11-24T19:59:00Z', [], 'Stocks close higher as Treasury yields ease'),
      item('2026-11-24T19:58:00Z', [], 'Acme Widgets price target raised to $12 at Small Bank'),
      item('2026-11-24T19:57:00Z', [], 'Tiny Corp announces new CFO'),
      item('2026-11-24T19:56:00Z', [], 'Bitcoin slips below a round number'),
    ], { after, until, limit: 10, slices: 4, perTicker: 3 })
    expect(picked.map((h) => h.headline)).toEqual(['Apple shares rise after launch', 'Stocks close higher as Treasury yields ease'])
  })

  test('spreads the picks across the window instead of taking only the last hours', () => {
    const late = Array.from({ length: 20 }, (_, i) => item(new Date(Date.parse('2026-11-24T20:59:00Z') - i * 60_000).toISOString(), ['MSFT']))
    const early = [item('2026-11-23T23:00:00Z', ['NVDA']), item('2026-11-24T04:00:00Z', ['AMZN']), item('2026-11-24T10:00:00Z', ['GOOG'])]
    const picked = pickHeadlines([...late, ...early], { after, until, limit: 8, slices: 4, perTicker: 100 })
    expect(picked).toHaveLength(8)
    for (const t of ['NVDA', 'AMZN', 'GOOG']) expect(picked.some((h) => h.tickers.includes(t))).toBe(true)
    // Newest first, as before.
    expect(picked.map((h) => h.publishedAt)).toEqual([...picked.map((h) => h.publishedAt)].sort().reverse())
  })

  test('caps how many headlines one ticker gets', () => {
    const many = Array.from({ length: 10 }, (_, i) => item(new Date(Date.parse('2026-11-24T20:00:00Z') - i * 60_000).toISOString(), ['TSLA']))
    const other = item('2026-11-24T12:00:00Z', ['AAPL'])
    const picked = pickHeadlines([...many, other], { after, until, limit: 10, slices: 1, perTicker: 3 })
    expect(picked.filter((h) => h.tickers.includes('TSLA'))).toHaveLength(3)
    expect(picked).toContainEqual(other)
  })
})
