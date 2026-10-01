import { beforeEach, describe, expect, test } from 'bun:test'
import { checkOrders } from '../core/complianceDesk.js'
import { closeOfDay } from '../core/metrics.js'
import { ringOpeningBell } from '../core/openingBell.js'
import { toMicro } from '../core/money.js'
import { awardBadges, badgesFor, periodStart, standings } from '../core/standings.js'
import { createTrader } from '../core/traders.js'
import { aTrader, anIndex, buy, NOW, setPrices, tradingDb } from './trading-fixture.js'

/** @type {import('bun:sqlite').Database} */
let db
/** @type {{ claude: number, gpt: number, weekly: number, index: number }} */
let ids

const MON = '2026-11-02'
const TUE = '2026-11-03'
const WED = '2026-11-04'
const THU = '2026-11-05'
const FRI = '2026-11-06'

beforeEach(() => {
  db = tradingDb()
  db.run("INSERT INTO runs (kind, model_id, status, started_at) VALUES ('trader', 1, 'succeeded', ?)", [NOW.toISOString()])
  const claude = aTrader(db, { name: 'Claude daily', startedOn: MON, rules: { position_cap_pct: 100 } })
  const gpt = aTrader(db, { name: 'GPT daily', startedOn: MON })
  const weekly = createTrader(db, { name: 'Claude weekly', modelId: 1, cadence: 'weekly', startedOn: MON, cashMicro: toMicro(1000), now: NOW })
  const index = anIndex(db, { startedOn: TUE })
  ids = { claude, gpt, weekly, index }

  // Claude daily buys $500 of Apple on Monday evening; it fills at Tuesday's open of $200.
  setPrices(db, MON, { AAPL: 200, SPY: 600 })
  checkOrders(db, { traderId: claude, runId: 1, date: MON, orders: [buy('AAPL', 500)], now: NOW })
  closeOfDay(db, MON)
  setPrices(db, TUE, { AAPL: [200, 220], SPY: 600 })
  ringOpeningBell(db, { date: TUE, now: NOW })
  closeOfDay(db, TUE)
  // 2.5 shares: worth $600 on Wednesday, $575 on Thursday, $625 on Friday.
  for (const [date, aapl] of /** @type {const} */ ([[WED, 240], [THU, 230], [FRI, 250]])) {
    setPrices(db, date, { AAPL: aapl, SPY: 600 })
    closeOfDay(db, date)
  }
})

describe('Standings', () => {
  test('a week starts on its first trading day; a month on the first trading day of the month', () => {
    expect(periodStart(db, 'day', THU)).toBe(THU)
    expect(periodStart(db, 'week', FRI)).toBe(MON)
    expect(periodStart(db, 'month', '2026-11-30')).toBe(MON)
    expect(periodStart(db, 'all', FRI)).toBe(null)
  })

  test('ranks the daily track by return over the week, with behaviour alongside', () => {
    const rows = standings(db, { track: 'daily', kind: 'week', end: FRI })
    expect(rows.map((r) => [r.rank, r.name, r.returnPct])).toEqual([[1, 'Claude daily', 12.5], [2, 'GPT daily', 0], [2, 'The Index', 0]])
    expect(rows[0]).toMatchObject({
      traderId: ids.claude, kind: 'ai', colourSlot: null, totalMicro: toMicro(1125), sinceStartPct: 12.5, vsIndexPct: 12.5,
      maxDrawdownPct: 2.27, cashSharePct: 44.44, trades: 1, ruleBreaks: 0,
    })
    expect(rows[2]).toMatchObject({ kind: 'benchmark', trades: 1 })
  })

  test('a day ranks against the close before it', () => {
    const [top] = standings(db, { track: 'daily', kind: 'day', end: FRI })
    expect(top).toMatchObject({ name: 'Claude daily', returnPct: 4.65 })
  })

  test('the weekly track holds the weekly Traders and The Index', () => {
    expect(standings(db, { track: 'weekly', kind: 'all', end: FRI }).map((r) => r.name)).toEqual(['Claude weekly', 'The Index'])
  })
})

describe('Badges', () => {
  test('are awarded to AI Traders at the end of a week and then read back as they were', () => {
    const awarded = awardBadges(db, 'week', FRI)
    expect(awarded).toEqual([
      { badge: 'Top return', traderId: ids.claude, name: 'Claude daily' },
      { badge: 'Most active', traderId: ids.claude, name: 'Claude daily' },
      { badge: 'Biggest cash pile', traderId: ids.gpt, name: 'GPT daily' },
      { badge: 'Biggest cash pile', traderId: ids.weekly, name: 'Claude weekly' },
    ])
    // Rules or data may change later; a finished week keeps its badges.
    db.run("DELETE FROM metrics")
    expect(badgesFor(db, 'week', FRI)).toEqual(awarded)
  })

  test('a badge everyone shares says nothing, so nobody gets it', () => {
    // Steadiest is for Traders that held shares, and only Claude daily did.
    expect(badgesFor(db, 'week', FRI).find((b) => b.badge === 'Steadiest')).toBeUndefined()
    expect(awardBadges(db, 'week', FRI).some((b) => b.badge === 'Fastest loss-cutter')).toBe(false)
  })

  test('a week still in progress gets provisional badges that are not stored', () => {
    expect(badgesFor(db, 'week', WED).map((b) => b.badge)).toContain('Top return')
    expect(db.query('SELECT COUNT(*) AS n FROM badges').get()).toEqual({ n: 0 })
  })
})
