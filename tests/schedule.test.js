import { beforeEach, describe, expect, test } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'
import { createAlpaca } from '../market/alpaca.js'
import { saveCalendar } from '../market/store.js'
import { dryRun, pauseExperiment, resumeExperiment, seedLineUp, startExperiment } from '../jobs/experiment.js'
import { dueSteps, rerunStep, tick } from '../jobs/schedule.js'
import { fakeAlpacaFetch } from './fake-alpaca.js'
import { calendar2026, testMarket, TEST_MENU } from './market-fixture.js'
import { testDb } from './helpers.js'
import traderAnswer from './recorded/trader-answer.json'
import columnistDaily from './recorded/columnist-daily.json'

/** @type {import('bun:sqlite').Database} */
let db
let clock = new Date()
const now = () => clock
/** @param {string} iso */
const at = (iso) => { clock = new Date(iso) }
/** @type {string[]} */
let calls = []

/** A stand-in model: Traders get the recorded answer, the Columnist its recorded post. */
const model = new MockLanguageModelV4({
  doGenerate: async (options) => {
    const system = String(options.prompt[0].content)
    const columnist = system.includes('Market Columnist')
    calls.push(columnist ? 'columnist' : 'trader')
    return {
      content: [{ type: 'text', text: JSON.stringify(columnist ? columnistDaily : traderAnswer) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: undefined }, outputTokens: { total: 200, text: 200, reasoning: undefined } },
      warnings: [],
    }
  },
})

/** @param {{ failFirst?: number }} [options] */
const context = (options = {}) => ({
  db,
  now,
  menu: TEST_MENU,
  alpaca: createAlpaca({ keyId: 'k', secretKey: 's', fetch: fakeAlpacaFetch(testMarket(), { pageSize: 500, ...options }).fetch, sleep: async () => {} }),
  languageModel: () => model,
  sleep: async () => {},
})

const steps = (/** @type {string} */ date) => db.query('SELECT step, status FROM step_runs WHERE trading_date = ? ORDER BY id').all(date)

beforeEach(() => {
  db = testDb()
  calls = []
})

/** Start on Monday 23 November 2026, at noon in New York. */
function startOnMonday() {
  saveCalendar(db, calendar2026())
  at('2026-11-23T17:00:00Z')
  return startExperiment(db, { now: clock })
}

describe('starting the experiment', () => {
  test('the line-up joins on the first decision evening and The Index on the open after it', () => {
    expect(startOnMonday()).toEqual({ startDate: '2026-11-23', dayOne: '2026-11-24' })
    expect(db.query("SELECT COUNT(*) AS n FROM traders WHERE kind = 'ai' AND started_on = '2026-11-23'").get()).toEqual({ n: 8 })
    expect(db.query("SELECT name, started_on FROM traders WHERE kind = 'benchmark'").get()).toEqual({ name: 'The Index', started_on: '2026-11-24' })
    expect(db.query("SELECT name, colour_slot FROM traders WHERE name LIKE 'Gemini%' ORDER BY id").all()).toEqual([{ name: 'Gemini daily', colour_slot: 3 }, { name: 'Gemini weekly', colour_slot: 3 }])
    expect(() => startExperiment(db, { now: clock })).toThrow('already started')
  })

  test('after the evening run has passed, the first decision is the next trading day', () => {
    saveCalendar(db, calendar2026())
    at('2026-11-25T23:00:00Z')
    // Thursday is Thanksgiving, so the next evening is Friday's.
    expect(startExperiment(db, { now: clock }).startDate).toBe('2026-11-27')
  })
})

describe('the scheduler', () => {
  test('does nothing while the experiment is being set up', async () => {
    saveCalendar(db, calendar2026())
    at('2026-11-23T22:00:00Z')
    expect(await tick(context())).toEqual([])
  })

  test('runs the evening steps in order once the close has settled, then the Opening Bell next morning', async () => {
    startOnMonday()
    at('2026-11-23T21:30:00Z') // 16:30 in New York: too early
    expect(dueSteps(db, clock)).toEqual([])

    at('2026-11-23T22:00:00Z')
    const evening = await tick(context())
    expect(evening.map((r) => [r.step, r.status])).toEqual([['floor-runner', 'succeeded'], ['daily-traders', 'succeeded'], ['daily-recap', 'succeeded']])
    expect(calls).toEqual(['trader', 'trader', 'trader', 'trader', 'columnist'])
    expect(db.query("SELECT COUNT(*) AS n FROM orders WHERE status = 'queued' AND fill_on = '2026-11-24'").get()).toEqual({ n: 8 })
    expect(db.query("SELECT COUNT(*) AS n FROM snapshots WHERE trading_date = '2026-11-23'").get()).toEqual({ n: 8 })
    expect(await tick(context())).toEqual([])

    at('2026-11-24T15:00:00Z') // 10:00 in New York
    const morning = await tick(context())
    expect(morning).toEqual([{ step: 'opening-bell', date: '2026-11-24', status: 'succeeded', note: 'Filled 9 orders.' }])
    expect(db.query("SELECT COUNT(*) AS n FROM positions p JOIN traders t ON t.id = p.trader_id WHERE t.kind = 'benchmark'").get()).toEqual({ n: 1 })
  })

  test('catches up on missed days in order, with the weekly steps on the last day of the week', async () => {
    startOnMonday()
    at('2026-11-27T20:00:00Z') // Friday, after the 13:00 early close settled
    await tick(context())
    expect(db.query("SELECT DISTINCT trading_date FROM step_runs ORDER BY id").values().flat()).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27'])
    expect(steps('2026-11-27')).toEqual(['opening-bell', 'floor-runner', 'daily-traders', 'weekly-traders', 'daily-recap', 'weekly-report'].map((step) => ({ step, status: 'succeeded' })))
    expect(db.query("SELECT kind, period_date FROM columnist_posts WHERE kind = 'weekly'").all()).toEqual([{ kind: 'weekly', period_date: '2026-11-27' }])
    expect(db.query("SELECT COUNT(*) AS n FROM decisions d JOIN traders t ON t.id = d.trader_id WHERE t.cadence = 'weekly'").get()).toEqual({ n: 4 })
  })

  test('retries a failed step on its own a few times, and the Trade Master can run it again', async () => {
    startOnMonday()
    at('2026-11-23T22:00:00Z')
    const down = context({ failFirst: 1000 })
    expect((await tick(down)).map((r) => [r.step, r.status])).toEqual([['floor-runner', 'failed']])
    // The Traders wait for a pack: nothing else ran.
    expect(calls).toEqual([])
    at('2026-11-23T22:10:00Z')
    expect(await tick(down)).toEqual([])
    at('2026-11-23T22:16:00Z')
    await tick(down)
    at('2026-11-23T22:32:00Z')
    await tick(down)
    at('2026-11-23T23:00:00Z')
    expect(await tick(down)).toEqual([])
    expect(db.query("SELECT status, attempt FROM step_runs WHERE step = 'floor-runner'").get()).toEqual({ status: 'failed', attempt: 3 })

    rerunStep(db, 'floor-runner', '2026-11-23')
    expect((await tick(context())).map((r) => r.step)).toEqual(['floor-runner', 'daily-traders', 'daily-recap'])
    expect(() => rerunStep(db, 'floor-runner', '2026-11-23')).toThrow('no failed or skipped')
  })

  test('a paused experiment skips its steps; on resume, waiting orders fill at the next open', async () => {
    startOnMonday()
    at('2026-11-23T22:00:00Z')
    await tick(context())
    pauseExperiment(db, clock)
    at('2026-11-24T15:00:00Z')
    expect(await tick(context())).toEqual([{ step: 'opening-bell', date: '2026-11-24', status: 'skipped', note: 'The experiment was paused.' }])
    at('2026-11-24T16:00:00Z')
    resumeExperiment(db, clock)
    expect(db.query("SELECT DISTINCT fill_on FROM orders WHERE status = 'queued'").values().flat()).toEqual(['2026-11-25'])
    at('2026-11-25T15:00:00Z')
    await tick(context())
    // Monday's orders waited through the pause and filled at Wednesday's open.
    expect(db.query("SELECT DISTINCT o.status, f.trading_date FROM orders o LEFT JOIN fills f ON f.order_id = o.id WHERE o.decided_on = '2026-11-23'").all())
      .toEqual([{ status: 'filled', trading_date: '2026-11-25' }])
  })

  test('at the budget ceiling, the weekly Traders and the daily recap pause', async () => {
    saveCalendar(db, calendar2026())
    at('2026-11-27T15:00:00Z')
    startExperiment(db, { now: clock })
    db.run('UPDATE settings SET budget_ceiling_micro = 1')
    at('2026-11-27T20:00:00Z')
    const result = await tick(context())
    expect(result.map((r) => [r.step, r.status])).toEqual([
      ['floor-runner', 'succeeded'], ['daily-traders', 'succeeded'], ['weekly-traders', 'skipped'], ['daily-recap', 'skipped'], ['weekly-report', 'succeeded'],
    ])
    expect(result[2].note).toContain('budget ceiling')
  })
})

describe('the dry run', () => {
  test('builds a pack if there is none, and every Trader decides without anything being queued', async () => {
    at('2026-11-24T22:00:00Z')
    const r = await dryRun(context())
    expect(r.packDate).toBe('2026-11-24')
    expect(r.results).toHaveLength(8)
    expect(r.results.every((x) => x.ok && x.verdicts.length === 2)).toBe(true)
    expect(db.query("SELECT DISTINCT status FROM orders").values().flat()).toEqual(['dry_run'])
    expect(db.query('SELECT DISTINCT dry_run FROM runs').values().flat()).toEqual([1])
    expect(db.query('SELECT COUNT(*) AS n FROM traders WHERE started_on IS NULL').get()).toEqual({ n: 8 })
    expect(seedLineUp(db, clock)).toBe(0)
  })
})
