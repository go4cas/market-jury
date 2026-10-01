import { describe, expect, test } from 'bun:test'
import { createAlpaca } from '../market/alpaca.js'
import { fakeAlpacaFetch } from './fake-alpaca.js'

const market = {
  calendar: [
    { date: '2026-11-25', open: '09:30', close: '16:00' },
    { date: '2026-11-27', open: '09:30', close: '13:00' },
  ],
  bars: {
    AAPL: [
      { t: '2026-11-25T05:00:00Z', o: 230.1, h: 232.5, l: 229.75, c: 231.4, v: 41_000_000 },
      { t: '2026-11-27T05:00:00Z', o: 231.5, h: 233, l: 231, c: 232.9, v: 20_000_000 },
    ],
    SPY: [
      { t: '2026-11-25T05:00:00Z', o: 600, h: 603, l: 599, c: 602.5, v: 50_000_000 },
      { t: '2026-11-27T05:00:00Z', o: 602.7, h: 604, l: 602, c: 603.9, v: 30_000_000 },
    ],
  },
  news: [
    { id: 1, headline: 'Apple ships thing', summary: 'Longer text', source: 'benzinga', url: 'https://example.com/1', created_at: '2026-11-25T15:00:00Z', symbols: ['AAPL'] },
    { id: 2, headline: 'Markets drift', summary: '', source: 'benzinga', url: 'https://example.com/2', created_at: '2026-11-25T19:00:00Z', symbols: [] },
    { id: 3, headline: 'Apple again', summary: '', source: 'benzinga', url: 'https://example.com/3', created_at: '2026-11-26T12:00:00Z', symbols: ['AAPL', 'ZZZZ'] },
    { id: 4, headline: 'Too late', summary: '', source: 'benzinga', url: 'https://example.com/4', created_at: '2026-11-28T12:00:00Z', symbols: ['AAPL'] },
  ],
  corporateActions: {
    forward_splits: [{ symbol: 'AAPL', new_rate: 4, old_rate: 1, ex_date: '2026-11-30', payable_date: '2026-11-27', process_date: '2026-11-30' }],
    reverse_splits: [],
    cash_dividends: [{ symbol: 'SPY', rate: 1.7, ex_date: '2026-12-19', payable_date: '2027-01-30', process_date: '2026-12-19', special: false, foreign: false }],
  },
}

const client = (options = {}) => {
  const fake = fakeAlpacaFetch(market, options)
  const alpaca = createAlpaca({ keyId: 'key', secretKey: 'secret', fetch: fake.fetch, sleep: async () => {} })
  return { alpaca, fake }
}

describe('Alpaca client', () => {
  test('reads the market calendar', async () => {
    const { alpaca } = client()
    expect(await alpaca.calendar('2026-11-20', '2026-11-30')).toEqual([
      { date: '2026-11-25', open: '09:30', close: '16:00' },
      { date: '2026-11-27', open: '09:30', close: '13:00' },
    ])
  })

  test('reads daily bars across pages as micro-dollars, dated in New York', async () => {
    const { alpaca, fake } = client()
    const bars = await alpaca.dailyBars(['AAPL', 'SPY'], '2026-11-25', '2026-11-27')
    expect(bars).toHaveLength(4)
    expect(bars).toContainEqual({ ticker: 'AAPL', date: '2026-11-25', openMicro: 230_100_000, highMicro: 232_500_000, lowMicro: 229_750_000, closeMicro: 231_400_000, volume: 41_000_000 })
    const barRequest = fake.requests.find((u) => u.pathname === '/v2/stocks/bars')
    expect(barRequest?.searchParams.get('adjustment')).toBe('raw')
    expect(barRequest?.searchParams.get('timeframe')).toBe('1Day')
  })

  test('asks for bars in batches of symbols', async () => {
    const { alpaca, fake } = client()
    const symbols = Array.from({ length: 250 }, (_, i) => `T${i}`)
    await alpaca.dailyBars(symbols, '2026-11-25', '2026-11-25')
    const batches = fake.requests.filter((u) => u.pathname === '/v2/stocks/bars').map((u) => u.searchParams.get('symbols')?.split(',').length)
    expect(batches).toEqual([100, 100, 50])
  })

  test('reads headlines in a time window, newest first, with their tickers', async () => {
    const { alpaca } = client()
    const news = await alpaca.news(new Date('2026-11-25T00:00:00Z'), new Date('2026-11-27T00:00:00Z'))
    expect(news.map((n) => n.externalId)).toEqual(['3', '2', '1'])
    expect(news[0]).toEqual({ externalId: '3', headline: 'Apple again', summary: '', source: 'benzinga', url: 'https://example.com/3', publishedAt: '2026-11-26T12:00:00Z', tickers: ['AAPL', 'ZZZZ'] })
  })

  test('stops reading headlines at the cap', async () => {
    const { alpaca } = client()
    expect(await alpaca.news(new Date('2026-11-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z'), { max: 2 })).toHaveLength(2)
  })

  test('reads splits and dividends', async () => {
    const { alpaca } = client()
    expect(await alpaca.corporateActions(['AAPL', 'SPY'], '2026-11-20', '2026-12-31')).toEqual([
      { ticker: 'AAPL', kind: 'split', exDate: '2026-11-30', payDate: '2026-11-27', splitFrom: 1, splitTo: 4, cashPerShareMicro: null },
      { ticker: 'SPY', kind: 'dividend', exDate: '2026-12-19', payDate: '2027-01-30', splitFrom: null, splitTo: null, cashPerShareMicro: 1_700_000 },
    ])
  })

  test('retries when Alpaca is briefly unavailable', async () => {
    const { alpaca } = client({ failFirst: 2 })
    expect(await alpaca.calendar('2026-11-20', '2026-11-30')).toHaveLength(2)
  })

  test('gives up with a plain message after three tries', async () => {
    const { alpaca } = client({ failFirst: 5 })
    expect(alpaca.calendar('2026-11-20', '2026-11-30')).rejects.toThrow('Alpaca did not answer')
  })

  test('refuses to fetch without keys, but can be created (so the server starts without them)', async () => {
    const alpaca = createAlpaca({ keyId: '', secretKey: '' })
    await expect(alpaca.calendar('2026-11-01', '2026-11-30')).rejects.toThrow('ALPACA_KEY_ID')
  })
})
