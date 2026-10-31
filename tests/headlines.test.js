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

  test('a quiet night and a busy last hour: unused picks go to the other slices in turn, not to the newest', () => {
    const lastHour = Array.from({ length: 30 }, (_, i) => item(new Date(Date.parse('2026-11-24T20:59:00Z') - i * 60_000).toISOString(), [`L${i}`]))
    const earlier = [
      item('2026-11-24T02:00:00Z', ['N1']), item('2026-11-24T09:00:00Z', ['N2']),
      item('2026-11-24T15:00:00Z', ['A1']), item('2026-11-24T15:30:00Z', ['A2']), item('2026-11-24T16:00:00Z', ['A3']),
      item('2026-11-24T17:00:00Z', ['B1']), item('2026-11-24T17:30:00Z', ['B2']), item('2026-11-24T18:00:00Z', ['B3']),
    ]
    // Pre-open, then the session (14:30 to 21:00 UTC) in three parts.
    const cuts = [new Date('2026-11-24T14:30:00Z'), new Date('2026-11-24T16:40:00Z'), new Date('2026-11-24T18:50:00Z')]
    const picked = pickHeadlines([...lastHour, ...earlier], { after, until, limit: 12, cuts, perTicker: 3 })
    expect(picked).toHaveLength(12)
    for (const h of earlier) expect(picked).toContainEqual(h)
    expect(picked.filter((h) => h.publishedAt >= '2026-11-24T20:00:00Z')).toHaveLength(4)
  })

  test('caps analyst rating notes on menu stocks', () => {
    const notes = Array.from({ length: 6 }, (_, i) => item(new Date(Date.parse('2026-11-24T20:00:00Z') - i * 60_000).toISOString(), [`R${i}`], `Bank maintains Buy on R${i}, raises price target`))
    const news = item('2026-11-24T12:00:00Z', ['AAPL'], 'Apple opens a new plant')
    const picked = pickHeadlines([...notes, news], { after, until, limit: 10, slices: 1, perTicker: 3, ratingNotes: 2 })
    expect(picked.filter((h) => h.headline.includes('price target'))).toHaveLength(2)
    expect(picked).toContainEqual(news)
  })
})
