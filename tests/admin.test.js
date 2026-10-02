import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { MockLanguageModelV4 } from 'ai/test'
import { startServer } from '../server/app.js'
import { createAlpaca } from '../market/alpaca.js'
import { saveCalendar } from '../market/store.js'
import { rulesFor } from '../core/portfolio.js'
import { fakeAlpacaFetch } from './fake-alpaca.js'
import { calendar2026, testMarket, TEST_MENU } from './market-fixture.js'
import { testClientDir, testDb } from './helpers.js'
import traderAnswer from './recorded/trader-answer.json'

/** @type {import('bun:sqlite').Database} */
let db
/** @type {ReturnType<typeof startServer>} */
let server
let clock = new Date('2026-11-23T17:00:00Z')
const TOKEN = 'test-session-token'
const COOKIE = `mj_session=${TOKEN}`

const model = new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [{ type: 'text', text: JSON.stringify(traderAnswer) }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } },
    warnings: [],
  }),
})

/**
 * @param {string} path
 * @param {{ method?: string, body?: object, cookie?: string }} [options]
 */
const call = (path, { method = 'GET', body, cookie = COOKIE } = {}) =>
  fetch(new URL(path, server.url), {
    method,
    headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })

/** @param {Promise<Response>} res */
const data = async (res) => /** @type {any} */ (await (await res).json())

beforeEach(() => {
  db = testDb()
  clock = new Date('2026-11-23T17:00:00Z')
  saveCalendar(db, calendar2026())
  db.run('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)', [createHash('sha256').update(TOKEN).digest('hex'), new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString()])
  server = startServer({
    db,
    port: 0,
    clientDir: testClientDir(),
    steps: {
      db,
      now: () => clock,
      menu: TEST_MENU,
      alpaca: createAlpaca({ keyId: 'k', secretKey: 's', fetch: fakeAlpacaFetch(testMarket(), { pageSize: 500 }).fetch, sleep: async () => {} }),
      languageModel: () => model,
      sleep: async () => {},
    },
  })
})

afterEach(() => server.stop(true))

describe('Trade Master routes', () => {
  test('every admin route, reads included, refuses a visitor', async () => {
    for (const [path, method] of [['/api/admin/status', 'GET'], ['/api/admin/settings', 'GET'], ['/api/admin/costs', 'GET'], ['/api/admin/experiment/start', 'POST'], ['/api/admin/dry-run', 'POST']]) {
      const res = await call(path, { method, cookie: '' })
      expect(res.status).toBe(401)
      expect(await data(Promise.resolve(res))).toEqual({ error: 'Log in as the Trade Master to do this.' })
    }
  })

  test('shows the set-up line-up, then starts the experiment', async () => {
    const status = await data(call('/api/admin/status'))
    expect(status).toMatchObject({ state: 'setup', startDate: null, firstDecisionDate: '2026-11-23', failedSteps: [], day: 0 })
    // When the next open is, for the Retire dialog's "sells at the next open".
    expect(status.nextOpen).toMatch(/^2026-11-2\dT14:30:00.000Z$/)
    const { traders } = await data(call('/api/admin/traders'))
    expect(traders[0].positions).toBe(0)
    expect(traders.map((/** @type {any} */ t) => t.name)).toEqual(['Claude daily', 'Claude weekly', 'GPT daily', 'GPT weekly', 'Gemini daily', 'Gemini weekly', 'DeepSeek daily', 'DeepSeek weekly'])

    const start = await call('/api/admin/experiment/start', { method: 'POST', body: {} })
    expect(await data(Promise.resolve(start))).toEqual({ startDate: '2026-11-23', dayOne: '2026-11-24' })
    expect((await data(call('/api/admin/status'))).state).toBe('running')
    const again = await call('/api/admin/experiment/start', { method: 'POST', body: {} })
    expect(again.status).toBe(400)
    expect(await data(Promise.resolve(again))).toEqual({ error: 'The experiment has already started.' })
    expect((await call('/api/admin/experiment/pause', { method: 'POST' })).status).toBe(200)
    expect((await call('/api/admin/experiment/resume', { method: 'POST' })).status).toBe(200)
  })

  test('changes settings: Gallery, budget, starting cash before the start, and guardrails from the next decision', async () => {
    await call('/api/admin/traders')
    const res = await call('/api/admin/settings', { method: 'PATCH', body: { galleryEnabled: true, budgetCeilingUsd: 30, startingCashUsd: 2000, positionCapPct: 25 } })
    expect(res.status).toBe(200)
    expect(await data(call('/api/admin/settings'))).toMatchObject({ galleryEnabled: true, budgetCeilingUsd: 30, startingCashUsd: 2000, positionCapPct: 25, perTradeCostUsd: 0 })
    expect(db.query("SELECT DISTINCT amount_micro FROM cash_ledger WHERE kind = 'start'").values().flat()).toEqual([2_000_000_000])

    await call('/api/admin/experiment/start', { method: 'POST', body: {} })
    const late = await call('/api/admin/settings', { method: 'PATCH', body: { startingCashUsd: 5000 } })
    expect(await data(Promise.resolve(late))).toEqual({ error: 'Starting cash can only change before the experiment starts.' })
    expect((await call('/api/admin/settings', { method: 'PATCH', body: { positionCapPct: 120 } })).status).toBe(400)
  })

  test('a refused settings change changes nothing, not even the fields that were fine', async () => {
    await call('/api/admin/traders')
    const snapshot = () => ({ settings: db.query('SELECT * FROM settings').get(), ledger: db.query('SELECT * FROM cash_ledger').all(), rules: db.query('SELECT * FROM rule_sets').all() })
    const before = snapshot()
    for (const body of [
      { galleryEnabled: true, budgetCeilingUsd: -1 },
      { galleryEnabled: true, startingCashUsd: 2000, positionCapPct: 120 },
      { galleryEnabled: true, positionCapPct: 10, perTradeCostUsd: -1 },
      { budgetCeilingUsd: 10_001 },
      { startingCashUsd: 1_000_001 },
      { perTradeCostUsd: 1_001 },
      { budgetCeilingUsd: 'Infinity' },
      { positionCapPct: 'lots' },
    ]) {
      expect((await call('/api/admin/settings', { method: 'PATCH', body })).status).toBe(400)
    }
    expect(snapshot()).toEqual(before)

    // Starting cash is refused once running, which happens mid-way through the writes.
    await call('/api/admin/experiment/start', { method: 'POST', body: {} })
    const started = snapshot()
    const late = await call('/api/admin/settings', { method: 'PATCH', body: { galleryEnabled: true, budgetCeilingUsd: 40, startingCashUsd: 5000, positionCapPct: 10 } })
    expect(late.status).toBe(400)
    expect(snapshot()).toEqual(started)
    expect(await data(call('/api/admin/settings'))).toMatchObject({ galleryEnabled: false, budgetCeilingUsd: 25, positionCapPct: 20 })
  })

  test('a Trader added after the guardrails change trades under the new guardrails', async () => {
    await call('/api/admin/settings', { method: 'PATCH', body: { positionCapPct: 10, perTradeCostUsd: 1 } })
    expect(await data(call('/api/admin/settings'))).toMatchObject({ positionCapPct: 10, perTradeCostUsd: 1 })
    await call('/api/admin/traders')
    await call('/api/admin/experiment/start', { method: 'POST', body: {} })
    const trader = { name: 'Late joiner', provider: 'anthropic', modelVersion: 'claude-opus-5-5', cadence: 'daily', inputUsdPerM: 5, outputUsdPerM: 25 }
    const { id, startedOn } = await data(call('/api/admin/traders', { method: 'POST', body: trader }))
    expect(rulesFor(db, id, startedOn)).toMatchObject({ position_cap_pct: 10, per_trade_cost_micro: 1_000_000 })
    // The set-up line-up, seeded after the change, has them too.
    const first = /** @type {{ id: number }} */ (db.query("SELECT id FROM traders WHERE kind = 'ai' ORDER BY id LIMIT 1").get())
    expect(rulesFor(db, first.id, startedOn)).toMatchObject({ position_cap_pct: 10, per_trade_cost_micro: 1_000_000 })
  })

  test('refuses a Trader with an overlong name or model version, or a price that is not a number', async () => {
    const trader = { name: 'Claude Opus daily', provider: 'anthropic', modelVersion: 'claude-opus-5-5', cadence: 'daily', inputUsdPerM: 5, outputUsdPerM: 25 }
    for (const body of [{ ...trader, name: 'x'.repeat(61) }, { ...trader, modelVersion: 'x'.repeat(101) }, { ...trader, inputUsdPerM: 'Infinity' }, { ...trader, cachedUsdPerM: -1 }, { ...trader, outputUsdPerM: 1e12 }]) {
      expect((await call('/api/admin/traders', { method: 'POST', body })).status).toBe(400)
    }
  })

  test('adds a Trader with its projected cost, and retires one at the next open', async () => {
    await call('/api/admin/experiment/start', { method: 'POST', body: {} })
    const trader = { name: 'Claude Opus daily', provider: 'anthropic', modelVersion: 'claude-opus-5-5', effort: 'medium', cadence: 'daily', inputUsdPerM: 5, cachedUsdPerM: 0.5, outputUsdPerM: 25 }
    const estimate = await data(call('/api/admin/traders/estimate', { method: 'POST', body: trader }))
    // 21 runs of 20,000 tokens in at $5 and 4,000 out at $25 per million.
    expect(estimate).toMatchObject({ addedUsd: 4.2, warning: null })
    const added = await call('/api/admin/traders', { method: 'POST', body: trader })
    expect(added.status).toBe(201)
    const { id, startedOn } = await data(Promise.resolve(added))
    expect(startedOn).toBe('2026-11-23')
    expect(db.query('SELECT colour_slot FROM traders WHERE id = ?').get(id)).toEqual({ colour_slot: 5 })

    const bad = await call('/api/admin/traders', { method: 'POST', body: { ...trader, provider: 'acme' } })
    expect(await data(Promise.resolve(bad))).toEqual({ error: 'The provider must be one of: anthropic, openai, google, deepseek.' })

    const retire = await call(`/api/admin/traders/${id}/retire`, { method: 'POST' })
    expect(await data(Promise.resolve(retire))).toEqual({ status: 'retiring' })
    expect((await call(`/api/admin/traders/${id}/retire`, { method: 'POST' })).status).toBe(400)
  })

  test('takes a ticker off the stock menu', async () => {
    db.run("INSERT INTO instruments (ticker, name, added_on) VALUES ('AAPL', 'Apple', '2026-01-02')")
    expect((await call('/api/admin/menu', { method: 'PATCH', body: { ticker: 'aapl', onMenu: false } })).status).toBe(200)
    expect(db.query("SELECT on_menu, removed_on FROM instruments WHERE ticker = 'AAPL'").get()).toEqual({ on_menu: 0, removed_on: '2026-11-23' })
    expect((await call('/api/admin/menu', { method: 'PATCH', body: { ticker: 'ZZZZ', onMenu: true } })).status).toBe(400)
  })

  test('runs a dry run in the background and reports it', async () => {
    clock = new Date('2026-11-24T22:00:00Z')
    const started = await call('/api/admin/dry-run', { method: 'POST' })
    expect(started.status).toBe(202)
    /** @type {any} */
    let state
    for (let i = 0; i < 100 && (!state || state.running); i++) {
      await Bun.sleep(20)
      state = await data(call('/api/admin/dry-run'))
    }
    expect(state.error).toBeNull()
    expect(state.result.packDate).toBe('2026-11-24')
    expect(state.result.results).toHaveLength(8)
    const costs = await data(call('/api/admin/costs'))
    expect(costs.byTrader).toHaveLength(8)
    expect(costs.budget).toMatchObject({ month: '2026-11', level: 'ok', ceilingUsd: 25 })
  })

  test('lists scheduler steps and re-runs a failed one', async () => {
    db.run("INSERT INTO step_runs (step, trading_date, status, attempt, error) VALUES ('floor-runner', '2026-11-20', 'failed', 3, 'Alpaca did not answer.')")
    const { steps } = await data(call('/api/admin/steps'))
    expect(steps[0]).toMatchObject({ step: 'floor-runner', status: 'failed' })
    expect((await data(call('/api/admin/status'))).failedSteps).toHaveLength(1)
    expect((await call('/api/admin/steps/rerun', { method: 'POST', body: { step: 'floor-runner', date: '2026-11-20' } })).status).toBe(200)
    expect(db.query('SELECT status, attempt FROM step_runs').get()).toEqual({ status: 'pending', attempt: 0 })
  })
})
