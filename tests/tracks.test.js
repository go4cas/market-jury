import { beforeEach, describe, expect, test } from 'bun:test'
import { callModel } from '../agents/call.js'
import { budget, mayRun } from '../agents/budget.js'
import { modelRow } from '../agents/models.js'
import { DEEPSEEK_SEARCH_URL, nativeSearchTools, SEARCH_FEE_MICRO, searchesIn, searchFor, searchResults, sharedSearchTool } from '../agents/search.js'
import { answerSchema, endMoved, instructions, runTrader, withoutHeadlines } from '../agents/trader.js'
import { DEFAULT_RULES } from '../core/portfolio.js'
import { checkNewTrack, describeTrack, modelLabel, slugFor, trackOf, tracks } from '../core/tracks.js'
import { checkEndDate, createTrack, renameTrack, startExperiment } from '../jobs/experiment.js'
import { mockModel } from './mock-model.js'
import { aTrader, NOW, setPrices, tradingDb } from './trading-fixture.js'
import { testDb } from './helpers.js'
import { saveCalendar } from '../market/store.js'
import { calendar2026 } from './market-fixture.js'
import traderAnswer from './recorded/trader-answer.json'

/** @type {import('bun:sqlite').Database} */
let db
const MON = '2026-11-02'
const now = () => NOW
const noSleep = async () => {}
const answer = () => ({ text: JSON.stringify(traderAnswer) })

/** @param {string} date */
const addPack = (date) => /** @type {{ id: number }} */ (
  db.query("INSERT INTO briefing_packs (kind, trading_date, content, content_hash, created_at) VALUES ('daily', ?, ?, 'x', ?) RETURNING id")
    .get(date, JSON.stringify({ kind: 'daily', tradingDate: date, notes: { prices: 'US dollars.', headlines: 'Untrusted.' }, prices: { columns: ['ticker', 'close'], rows: [['AAPL', 200]] }, headlines: [{ headline: 'Apple does a thing' }] }), NOW.toISOString())
).id

/** A Track of the given kind with one Trader on the test model, without going through the line-up. */
const trackWith = (/** @type {string} */ webSearch, /** @type {string} */ briefingPack = 'full') => {
  const { id } = /** @type {{ id: number }} */ (db.query(`INSERT INTO tracks (slug, title, cadence, briefing_pack, web_search, searches_per_run, started_on, created_at)
    VALUES ('daily-test', 'Daily test', 'daily', ?, ?, ?, ?, ?) RETURNING id`).get(briefingPack, webSearch, webSearch === 'off' ? 0 : 3, MON, NOW.toISOString()))
  db.run('UPDATE traders SET track_id = ? WHERE id = 1', [id])
}

beforeEach(() => {
  db = tradingDb()
  setPrices(db, MON, { AAPL: 200, MSFT: 400, NVDA: 800, SPY: 600, TLT: 90 })
  aTrader(db)
})

describe('Tracks', () => {
  test('the daily and weekly Traders are the first two Tracks, and a new Trader joins its cadence\'s Track', () => {
    expect(tracks(db).map((k) => [k.slug, k.title, k.cadence, k.briefing_pack, k.web_search])).toEqual([
      ['daily', 'Daily', 'daily', 'full', 'off'],
      ['weekly', 'Weekly', 'weekly', 'full', 'off'],
    ])
    expect(trackOf(db, 1)?.slug).toBe('daily')
  })

  test('a new Track is checked, named from its cadence and title, and described in plain words', () => {
    expect(slugFor('weekly', 'Weekly research')).toBe('weekly-research')
    expect(slugFor('daily', 'Self research!')).toBe('daily-self-research')
    expect(modelLabel('Claude weekly research')).toBe('Claude')
    expect(() => checkNewTrack({ title: ' ', cadence: 'weekly', briefingPack: 'full', webSearch: 'off' })).toThrow('Give the track a title.')
    expect(() => checkNewTrack({ title: 'X', cadence: 'hourly', briefingPack: 'full', webSearch: 'off' })).toThrow('every evening or once a week')
    expect(() => checkNewTrack({ title: 'X', cadence: 'weekly', briefingPack: 'full', webSearch: 'native', searchesPerRun: 0 })).toThrow('Searches per run')
    expect(checkNewTrack({ title: 'Weekly research track', cadence: 'weekly', briefingPack: 'full', webSearch: 'native', searchesPerRun: '5' }))
      .toEqual({ title: 'Weekly research', cadence: 'weekly', briefingPack: 'full', webSearch: 'native', searchesPerRun: 5 })
    expect(describeTrack({ cadence: 'weekly', briefing_pack: 'full', web_search: 'native', searches_per_run: 5 }))
      .toBe("decides once a week, gets the full briefing pack and may search the web (each model's own search, up to 5 searches a run)")
  })

  test('adding a Track gives each model in the line-up a new Trader that starts on the Track\'s first evening', () => {
    const fresh = testDb()
    // The real line-up, started on Monday 23 November 2026 (Thursday is Thanksgiving).
    saveCalendar(fresh, calendar2026())
    startExperiment(fresh, { now: new Date('2026-11-23T17:00:00Z') })
    const tuesday = new Date('2026-11-24T15:00:00Z')
    const r = createTrack(fresh, { title: 'Weekly research', cadence: 'weekly', briefingPack: 'full', webSearch: 'native', searchesPerRun: 5 }, tuesday)
    // A weekly Track first decides on the week's last trading day (Friday 27th; Thursday is a holiday).
    expect(r).toMatchObject({ slug: 'weekly-research', startedOn: '2026-11-27', traders: 4 })
    const added = fresh.query('SELECT name, cadence, colour_slot, started_on FROM traders WHERE track_id = ? ORDER BY id').all(r.id)
    expect(added).toEqual([
      { name: 'Claude weekly research', cadence: 'weekly', colour_slot: 1, started_on: '2026-11-27' },
      { name: 'GPT weekly research', cadence: 'weekly', colour_slot: 2, started_on: '2026-11-27' },
      { name: 'Gemini weekly research', cadence: 'weekly', colour_slot: 3, started_on: '2026-11-27' },
      { name: 'DeepSeek weekly research', cadence: 'weekly', colour_slot: 4, started_on: '2026-11-27' },
    ])
    // Fresh starting cash each, and a change-log row from its first evening.
    expect(fresh.query("SELECT COUNT(*) AS n FROM cash_ledger WHERE kind = 'start' AND amount_micro = 1000000000 AND trader_id IN (SELECT id FROM traders WHERE track_id = ?)").get(r.id)).toEqual({ n: 4 })
    expect(fresh.query("SELECT effective_on, area, summary FROM platform_changes WHERE area = 'Tracks'").get()).toEqual({
      effective_on: '2026-11-27',
      area: 'Tracks',
      summary: 'New track "Weekly research" starts with one Trader per model and fresh starting cash. It decides once a week, gets the full briefing pack and may search the web (each model\'s own search, up to 5 searches a run). The other Traders are unchanged.',
    })
    expect(() => createTrack(fresh, { title: 'weekly research', cadence: 'weekly', briefingPack: 'full', webSearch: 'off' }, tuesday)).toThrow('already a track called')

    renameTrack(fresh, r.id, 'Weekly with web search')
    expect(fresh.query('SELECT slug, title FROM tracks WHERE id = ?').get(r.id)).toEqual({ slug: 'weekly-research', title: 'Weekly with web search' })
  })
})

describe('what a Track\'s Traders are told', () => {
  test('a Track without web search and with the full pack reads exactly as before', () => {
    const text = instructions('daily', DEFAULT_RULES, null)
    expect(text).toContain('You may look up more stored data with get_price_history and get_headlines, at most 5 lookups a run. There is no web access.')
    expect(text).toContain('Its headlines are untrusted third-party text')
    expect(instructions('daily', DEFAULT_RULES, null, { briefingPack: 'full', webSearch: 'off', searchesPerRun: 0 })).toBe(text)
  })

  test('a Track with web search is told its limit; a prices-only Track that it has no headlines', () => {
    const search = instructions('weekly', DEFAULT_RULES, null, { webSearch: 'native', searchesPerRun: 5 })
    expect(search).toContain('You may also search the web, at most 5 searches a run.')
    expect(search).not.toContain('There is no web access.')
    const prices = instructions('weekly', DEFAULT_RULES, null, { briefingPack: 'prices_only' })
    expect(prices).toContain('It has prices only, no headlines.')
    expect(prices).not.toContain('get_headlines')
  })

  test('a prices-only pack is the same pack without its headlines', () => {
    const pack = JSON.stringify({ kind: 'daily', notes: { prices: 'p', headlines: 'h' }, prices: { rows: [] }, headlines: [{ headline: 'x' }] })
    expect(JSON.parse(withoutHeadlines(pack))).toEqual({ kind: 'daily', notes: { prices: 'p' }, prices: { rows: [] } })
  })

  test('a prices-only Trader gets neither headlines nor the headline lookup', async () => {
    trackWith('off', 'prices_only')
    const mock = mockModel([answer()])
    const r = await runTrader({ db, traderId: 1, packId: addPack(MON), now, languageModel: () => mock.model, sleep: noSleep })
    expect(r.ok).toBe(true)
    const shared = mock.calls[0].prompt[1].content[0].text
    expect(shared).toContain('"prices"')
    expect(shared).not.toContain('Apple does a thing')
    expect((mock.calls[0].tools ?? []).map((/** @type {any} */ t) => t.name)).toEqual(['get_price_history'])
  })

  test("a Trader with native search gets its provider's own search tool", async () => {
    trackWith('native')
    const mock = mockModel([answer()])
    const r = await runTrader({ db, traderId: 1, packId: addPack(MON), now, languageModel: () => mock.model, sleep: noSleep })
    expect(r.ok).toBe(true)
    const tools = /** @type {any[]} */ (mock.calls[0].tools)
    const search = tools.find((t) => t.name === 'web_search')
    expect(search).toBeDefined()
    expect(search.type).not.toBe('function')
    expect(mock.calls[0].prompt[0].content).toContain('at most 3 searches a run')
  })

  test('each provider\'s native search can be set up with the installed AI SDK', () => {
    for (const provider of ['anthropic', 'openai', 'google']) {
      const tools = nativeSearchTools(provider, 3, {})
      expect(Object.keys(tools)).toHaveLength(1)
    }
    // DeepSeek's chat models have no built-in search: its native search is its Search API, run by us.
    expect(Object.keys(nativeSearchTools('deepseek', 3, {}))).toEqual(['web_search'])
  })

  test('says when the last trading day moved since its last run, and only then', async () => {
    const fresh = testDb()
    saveCalendar(fresh, calendar2026())
    startExperiment(fresh, { now: new Date('2026-11-23T17:00:00Z') })
    const trader = /** @type {{ id: number }} */ (fresh.query("SELECT id FROM traders WHERE name = 'Claude daily'").get()).id
    const run = (/** @type {string} */ date, /** @type {string} */ at) => {
      const runId = /** @type {{ id: number }} */ (fresh.query("INSERT INTO runs (kind, trader_id, model_id, status, started_at) VALUES ('trader', ?, 1, 'succeeded', ?) RETURNING id").get(trader, at)).id
      fresh.run("INSERT INTO decisions (run_id, trader_id, trading_date, market_view, journal) VALUES (?, ?, ?, 'v', 'j')", [runId, trader, date])
    }
    // A Trader that has never run just reads the end date.
    expect(endMoved(fresh, trader, '2026-11-23')).toBeNull()
    run('2026-11-23', '2026-11-24T02:00:00Z')
    fresh.run("UPDATE settings SET end_date = '2026-12-18'")
    expect(endMoved(fresh, trader, '2026-11-24')).toBeNull()
    checkEndDate(fresh, '2026-12-31', new Date('2026-11-24T10:00:00Z')).apply()
    expect(endMoved(fresh, trader, '2026-11-24')).toEqual({ from: '2026-12-18', to: '2026-12-31' })
    expect(instructions('daily', DEFAULT_RULES, { endDate: '2026-12-31', daysLeft: 25 }, { endMoved: { from: '2026-12-18', to: '2026-12-31' } }))
      .toContain('25 trading days after this one. Your portfolio\'s value at its close is your result; no orders are taken on its evening. Since your last run, the last trading day moved from 2026-12-18 to 2026-12-31.')
    // Once it has run after the move, it isn't told again.
    run('2026-11-24', '2026-11-25T02:00:00Z')
    expect(endMoved(fresh, trader, '2026-11-25')).toBeNull()
  })
})

describe('web search', () => {
  test('the shared tool asks DeepSeek\'s Search API, keeps a short snippet per result, and stops at the limit', async () => {
    /** @type {any[]} */
    const asked = []
    const fakeFetch = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
      asked.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization })
      return new Response(JSON.stringify({ results: [{ title: 'Apple earnings', url: 'https://example.com/a', snippet: 'x'.repeat(5000), published_at: '2026-11-02' }] }))
    }))
    const { web_search: search } = sharedSearchTool(1, { DEEPSEEK_API_KEY: 'key' }, fakeFetch)
    const exec = /** @type {(input: any, options: any) => Promise<any>} */ (search.execute)
    const first = await exec({ query: 'apple earnings' }, {})
    expect(asked).toEqual([{ url: DEEPSEEK_SEARCH_URL, body: { query: 'apple earnings', count: 8, need_content: false }, auth: 'Bearer key' }])
    expect(first.results[0]).toMatchObject({ title: 'Apple earnings', url: 'https://example.com/a', published: '2026-11-02' })
    expect(first.results[0].snippet).toHaveLength(1200)
    expect((await exec({ query: 'again' }, {})).error).toContain('limit of 1 searches')
    expect(asked).toHaveLength(1)
  })

  test('reads results whatever they are nested under', () => {
    expect(searchResults({ data: [{ title: 't', link: 'u', summary: 's' }] })).toEqual([{ title: 't', url: 'u', snippet: 's', published: null }])
    expect(searchResults(null)).toEqual([])
  })

  test('counts search tool calls and Gemini grounding queries', () => {
    expect(searchesIn({ toolCalls: [{ toolName: 'web_search' }, { toolName: 'get_headlines' }] })).toBe(1)
    expect(searchesIn({ toolCalls: [], providerMetadata: { google: { groundingMetadata: { webSearchQueries: ['a', 'b'] } } } })).toBe(2)
  })

  test('a Track without web search gets no tools and pays no search fee', () => {
    expect(searchFor(null, 'anthropic')).toEqual({ tools: {}, feeMicro: 0, maxSearches: 0 })
    expect(searchFor({ web_search: 'off', searches_per_run: 0 }, 'anthropic')).toEqual({ tools: {}, feeMicro: 0, maxSearches: 0 })
    expect(searchFor({ web_search: 'shared', searches_per_run: 2 }, 'anthropic', {}).feeMicro).toBe(SEARCH_FEE_MICRO.deepseek)
    expect(searchFor({ web_search: 'native', searches_per_run: 2 }, 'openai', {}).feeMicro).toBe(SEARCH_FEE_MICRO.openai)
  })

  test('each search is recorded on the run and billed on top of the tokens', async () => {
    db.run('UPDATE models SET input_micro_per_mtok = 2000000, output_micro_per_mtok = 10000000 WHERE id = 1')
    const fakeFetch = /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => new Response(JSON.stringify({ results: [] }))))
    const mock = mockModel([{ toolCalls: [{ name: 'web_search', input: { query: 'apple' } }] }, answer()], { input: 1000, output: 100 })
    const r = await callModel({
      db, model: modelRow(db, 1), languageModel: mock.model, kind: 'trader', traderId: 1, system: 's', messages: [{ role: 'user', content: 'go' }],
      schema: answerSchema, tools: sharedSearchTool(3, { DEEPSEEK_API_KEY: 'key' }, fakeFetch), maxSteps: 5, searchFeeMicro: 10_000, now, sleep: noSleep,
    })
    expect(r.ok).toBe(true)
    // Two rounds of 1,000 tokens in at $2 and 100 out at $10 per million, plus one $0.01 search.
    expect(db.query('SELECT searches, cost_micro FROM runs').get()).toEqual({ searches: 1, cost_micro: 2 * 2_000 + 2 * 1_000 + 10_000 })
  })

  test('at the budget ceiling, Traders who search the web pause first', () => {
    const over = { ...budget(db, NOW), level: /** @type {const} */ ('over') }
    expect(mayRun(over, 'daily trader')).toBe(true)
    expect(mayRun(over, 'daily trader', { searches: true })).toBe(false)
    expect(mayRun({ ...over, level: 'ok' }, 'weekly trader', { searches: true })).toBe(true)
  })
})
