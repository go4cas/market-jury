// A week of the experiment run by the real scheduler on fake market data and
// recorded model answers: start on Monday 23 November 2026, then catch up to
// Friday's evening (Thursday is Thanksgiving). Used by the read-route tests and
// to seed the end-to-end server.
import { MockLanguageModelV4 } from 'ai/test'
import { createAlpaca } from '../market/alpaca.js'
import { saveCalendar } from '../market/store.js'
import { startExperiment } from '../jobs/experiment.js'
import { tick } from '../jobs/schedule.js'
import { fakeAlpacaFetch } from './fake-alpaca.js'
import { calendar2026, testMarket, TEST_MENU } from './market-fixture.js'
import traderAnswer from './recorded/trader-answer.json'
import columnistDaily from './recorded/columnist-daily.json'

/** Traders get the recorded answer; the Columnist its recorded post. */
export const recordedModel = new MockLanguageModelV4({
  doGenerate: async (options) => {
    const columnist = String(options.prompt[0].content).includes('Market Columnist')
    return {
      content: [{ type: 'text', text: JSON.stringify(columnist ? columnistDaily : traderAnswer) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: undefined }, outputTokens: { total: 200, text: 200, reasoning: undefined } },
      warnings: [],
    }
  },
})

/**
 * What the scheduler needs, with fakes, at a fixed clock.
 * @param {import('bun:sqlite').Database} db
 * @param {() => Date} now
 * @returns {import('../jobs/schedule.js').StepContext}
 */
export const sampleSteps = (db, now) => ({
  db,
  now,
  menu: TEST_MENU,
  alpaca: createAlpaca({ keyId: 'k', secretKey: 's', fetch: fakeAlpacaFetch(testMarket(), { pageSize: 500 }).fetch, sleep: async () => {} }),
  languageModel: () => recordedModel,
  sleep: async () => {},
})

/**
 * @param {import('bun:sqlite').Database} db a migrated, empty database
 */
export async function runSampleWeek(db) {
  saveCalendar(db, calendar2026())
  startExperiment(db, { now: new Date('2026-11-23T17:00:00Z') })
  const friday = new Date('2026-11-27T20:00:00Z')
  await tick(sampleSteps(db, () => friday))
}
