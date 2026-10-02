import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { startServer } from '../server/app.js'
import { marketStatus } from '../server/reads.js'
import { testClientDir, testDb } from './helpers.js'
import { runSampleWeek, sampleSteps } from './sample-week.js'
import traderAnswer from './recorded/trader-answer.json'
import columnistDaily from './recorded/columnist-daily.json'

/** @type {import('bun:sqlite').Database} */
let db
/** @type {ReturnType<typeof startServer>} */
let server
const TOKEN = 'test-session-token'

/**
 * @param {string} path
 * @param {{ cookie?: string }} [options]
 */
const get = async (path, { cookie = `mj_session=${TOKEN}` } = {}) => {
  const res = await fetch(new URL(path, server.url), { headers: { Cookie: cookie } })
  return { status: res.status, body: /** @type {any} */ (await res.json()) }
}

beforeAll(async () => {
  db = testDb()
  db.run('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)', [createHash('sha256').update(TOKEN).digest('hex'), new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString()])
  await runSampleWeek(db)
  const friday = new Date('2026-11-27T20:00:00Z')
  server = startServer({ db, port: 0, clientDir: testClientDir(), steps: sampleSteps(db, () => friday) })
})

afterEach(() => db.run('UPDATE settings SET gallery_enabled = 0'))

describe('Gallery reads', () => {
  test('are closed to visitors until the Gallery is switched on', async () => {
    for (const path of ['/api/overview', '/api/series', '/api/standings', '/api/days/latest', '/api/history', '/api/traders', '/api/traders/1', '/api/columnist']) {
      const res = await get(path, { cookie: '' })
      expect(res.status).toBe(401)
      expect(res.body.error).toBe('The Gallery is closed. Log in as the Trade Master to see this.')
    }
    db.run('UPDATE settings SET gallery_enabled = 1')
    expect((await get('/api/overview', { cookie: '' })).status).toBe(200)
  })

  test('the Overview: status, movers, standings and the latest recap', async () => {
    const { body } = await get('/api/overview')
    expect(body.status).toMatchObject({ state: 'running', startDate: '2026-11-23', latestDate: '2026-11-27', day: 3, market: 'closed', changesAt: '2026-11-30T14:30:00.000Z' })
    expect(body.movers.map((/** @type {any} */ m) => m.ticker)).toContain('SPY')
    expect(body.standings.daily.map((/** @type {any} */ r) => r.name).sort()).toEqual(['Claude daily', 'DeepSeek daily', 'GPT daily', 'Gemini daily', 'The Index'])
    expect(body.standings.weekly).toHaveLength(5)
    expect(body.recap).toMatchObject({ kind: 'daily', date: '2026-11-27', headline: columnistDaily.headline })
  })

  test('the Overview carries what the landing hero shows', async () => {
    const { body } = await get('/api/overview')
    expect(body.hero).toMatchObject({ traders: 8, startingCashMicro: 1_000_000_000, totalDays: 63 })
    expect(body.hero.trades).toBe(db.query('SELECT COUNT(*) AS n FROM fills').get().n)
    // The jury box: every daily Trader still trading, then The Index.
    expect(body.hero.daily.map((/** @type {any} */ t) => t.name)).toEqual(['Claude daily', 'GPT daily', 'Gemini daily', 'DeepSeek daily', 'The Index'])
    expect(body.hero.daily[0]).toMatchObject({ kind: 'ai', colourSlot: 1 })
    expect(body.hero.daily[0].totalMicro).toBeGreaterThan(0)
  })

  test('the market status: open, opening soon, closed, and holidays', () => {
    // Friday 27 November 2026 is a half day: 09:30 to 13:00 in New York (14:30 to 18:00 UTC).
    expect(marketStatus(db, new Date('2026-11-27T14:00:00Z'))).toEqual({ market: 'soon', changesAt: '2026-11-27T14:30:00.000Z' })
    expect(marketStatus(db, new Date('2026-11-27T15:00:00Z'))).toEqual({ market: 'open', changesAt: '2026-11-27T18:00:00.000Z' })
    expect(marketStatus(db, new Date('2026-11-27T20:00:00Z'))).toEqual({ market: 'closed', changesAt: '2026-11-30T14:30:00.000Z' })
    // Thanksgiving: a weekday with no trading.
    expect(marketStatus(db, new Date('2026-11-26T15:00:00Z'))).toEqual({ market: 'holiday', changesAt: '2026-11-27T14:30:00.000Z' })
    // Early on a trading day, more than an hour before the open.
    expect(marketStatus(db, new Date('2026-11-24T12:00:00Z'))).toEqual({ market: 'closed', changesAt: '2026-11-24T14:30:00.000Z' })
  })

  test('the value chart: every close, one line per Trader on the track and The Index', async () => {
    const { body } = await get('/api/series?track=weekly')
    expect(body.dates).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27'])
    expect(body.series.map((/** @type {any} */ s) => s.name)).toEqual(['Claude weekly', 'GPT weekly', 'Gemini weekly', 'DeepSeek weekly', 'The Index'])
    // The Index starts on day one, so it has no value on the start evening.
    expect(body.series[4].values[0]).toBeNull()
    expect(body.series[0].values[0]).toBe(1_000_000_000)
  })

  test('standings for a week, with badges and the past periods to pick from', async () => {
    const { body } = await get('/api/standings?track=daily&kind=week')
    expect(body).toMatchObject({ kind: 'week', end: '2026-11-27', start: '2026-11-23', periods: { latest: '2026-11-27', weeks: ['2026-11-27'], months: ['2026-11-27'] } })
    expect(body.rows[0]).toHaveProperty('maxDrawdownPct')
    // The week ended, so the floor-runner step stored its badges.
    expect(db.query("SELECT COUNT(*) AS n FROM badges WHERE period_kind = 'week' AND period_end = '2026-11-27'").get()).not.toEqual({ n: 0 })
    expect(body.badges.length).toBeGreaterThan(0)
  })

  test('yesterday: one card per Trader that decided, with its orders and how they filled', async () => {
    const { body } = await get('/api/days/latest')
    expect(body).toMatchObject({ date: '2026-11-27', fillDate: '2026-11-30', prev: '2026-11-25', next: null })
    // Friday is the last trading day of the week, so the weekly Traders decided too.
    expect(body.cards).toHaveLength(8)
    const card = body.cards[0]
    expect(card).toMatchObject({ name: 'Claude daily', decided: true, marketView: traderAnswer.market_view })
    // By Friday Apple is at the 20% cap, so the Compliance Desk rejects more of it; the reason stays verbatim.
    expect(card.orders[0]).toMatchObject({ reason: traderAnswer.orders[0].reason, verdict: 'rejected', verdictNote: expect.stringContaining('20% position cap') })
    expect(body.counts.rejected).toBeGreaterThan(0)

    const tuesday = (await get('/api/days/2026-11-24')).body
    expect(tuesday.cards).toHaveLength(4)
    const passed = tuesday.cards.flatMap((/** @type {any} */ c) => c.orders).filter((/** @type {any} */ o) => o.verdict !== 'rejected')
    expect(passed.length).toBeGreaterThan(0)
    expect(passed.every((/** @type {any} */ o) => o.status === 'filled' && o.priceMicro > 0 && o.filledOn === '2026-11-25')).toBe(true)
    expect((await get('/api/days/not-a-date')).status).toBe(400)
    expect((await get('/api/days/2026-11-26')).body.error).toBe('2026-11-26 was not a trading day, so nobody decided anything.')
    expect((await get('/api/days/2026-11-30')).status).toBe(404)
  })

  test('history: running totals and a card per week', async () => {
    const { body } = await get('/api/history')
    expect(body.totals).toMatchObject({ tradingDays: 3, missedRuns: 0 })
    expect(body.totals.trades).toBeGreaterThan(0)
    expect(body.weeks).toHaveLength(1)
    expect(body.weeks[0]).toMatchObject({ number: 1, start: '2026-11-23', end: '2026-11-27', complete: true, post: { headline: columnistDaily.headline } })
    expect(body.weeks[0].days.map((/** @type {any} */ d) => d.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27'])
  })

  test('a Trader: holdings, values against The Index, trades with reasons, journal and behaviour', async () => {
    const { body: list } = await get('/api/traders')
    const claude = list.traders.find((/** @type {any} */ t) => t.name === 'Claude daily')
    expect(claude).toMatchObject({ provider: 'anthropic', cadence: 'daily', colourSlot: 1 })
    const { body } = await get(`/api/traders/${claude.id}`)
    expect(body.trader.name).toBe('Claude daily')
    expect(body.asOf).toBe('2026-11-27')
    expect(body.holdings.length).toBeGreaterThan(0)
    expect(body.values.map((/** @type {any} */ v) => v.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27'])
    expect(body.indexValues).toHaveLength(3)
    expect(body.trades[0]).toHaveProperty('reason')
    expect(body.decisions[0]).toMatchObject({ date: '2026-11-27', journal: traderAnswer.journal })
    expect(body.metrics.at(-1)).toHaveProperty('cash_share_pct')
    expect((await get('/api/traders/999')).status).toBe(404)
  })

  test('the Columnist: posts newest first', async () => {
    const { body } = await get('/api/columnist')
    expect(body.posts.map((/** @type {any} */ p) => [p.kind, p.date])).toEqual([['weekly', '2026-11-27'], ['daily', '2026-11-27'], ['daily', '2026-11-25'], ['daily', '2026-11-24'], ['daily', '2026-11-23']])
    expect((await get('/api/columnist?kind=weekly')).body.posts).toHaveLength(1)
  })

  test('the briefing pack is for the Trade Master only', async () => {
    db.run('UPDATE settings SET gallery_enabled = 1')
    expect((await get('/api/admin/packs', { cookie: '' })).status).toBe(401)
    const { body } = await get('/api/admin/packs?date=2026-11-24')
    expect(body).toMatchObject({ kind: 'daily', date: '2026-11-24', dates: ['2026-11-27', '2026-11-25', '2026-11-24', '2026-11-23'] })
    expect(body.pack.prices.columns[0]).toBe('ticker')
    expect((await get('/api/admin/packs?date=2026-11-26')).status).toBe(404)
  })
})
