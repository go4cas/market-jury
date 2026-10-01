import { beforeEach, describe, expect, test } from 'bun:test'
import { checkOrders } from '../core/complianceDesk.js'
import { closeOfDay } from '../core/metrics.js'
import { ringOpeningBell } from '../core/openingBell.js'
import { toMicro } from '../core/money.js'
import { aTrader, anIndex, buy, NOW, sell, setPrices, tradingDb } from './trading-fixture.js'

/** @type {import('bun:sqlite').Database} */
let db

const MON = '2026-11-02'
const TUE = '2026-11-03'
const WED = '2026-11-04'
const THU = '2026-11-05'
const FRI = '2026-11-06'

/** @param {number} traderId @param {string} date @param {any[]} orders */
const decide = (traderId, date, orders) => checkOrders(db, { traderId, runId: 1, date, orders, now: NOW })
/** @param {string} date */
const bell = (date) => ringOpeningBell(db, { date, now: NOW })
/** @param {number} traderId @param {string} date */
const metrics = (traderId, date) => Object.fromEntries(db.query('SELECT key, value FROM metrics WHERE trader_id = ? AND trading_date = ?').values(traderId, date))
/** @param {number} traderId @param {string} date */
const snapshot = (traderId, date) => db.query('SELECT cash_micro, holdings_micro, total_micro FROM snapshots WHERE trader_id = ? AND trading_date = ?').get(traderId, date)

beforeEach(() => {
  db = tradingDb()
  // runs.id 1 so orders count as a Trader's own (not The Index's or a retirement's).
  db.run("INSERT INTO runs (kind, model_id, status, started_at) VALUES ('trader', 1, 'succeeded', ?)", [NOW.toISOString()])
  for (const d of [MON, TUE, WED, THU, FRI]) setPrices(db, d, { AAPL: 200, MSFT: 400, NVDA: 800, SPY: 600, TLT: 90 })
})

describe('End of day: snapshots and behaviour metrics', () => {
  test('snapshots cash, holdings and total at the close, and the return against The Index', () => {
    // A Trader starts on the evening of its first decision; The Index on the open after it.
    const t = aTrader(db, { startedOn: MON })
    const index = anIndex(db, { startedOn: TUE })
    decide(t, MON, [buy('AAPL', 200)])
    setPrices(db, TUE, { AAPL: [200, 250], SPY: [625, 631.25] })
    bell(TUE)
    expect(closeOfDay(db, TUE)).toEqual({ traders: 2 })
    expect(snapshot(t, TUE)).toEqual({ cash_micro: toMicro(800), holdings_micro: toMicro(250), total_micro: toMicro(1050) })
    expect(snapshot(index, TUE)).toEqual({ cash_micro: 0, holdings_micro: toMicro(1010), total_micro: toMicro(1010) })
    expect(metrics(t, TUE)).toMatchObject({ return_pct: 5, index_return_pct: 1, vs_index_pct: 4 })
    expect(metrics(index, TUE)).toMatchObject({ return_pct: 1, vs_index_pct: 0 })
  })

  test('a late joiner is compared with The Index over its own dates', () => {
    const index = anIndex(db, { startedOn: TUE })
    setPrices(db, TUE, { SPY: 625 })
    bell(TUE)
    setPrices(db, WED, { SPY: 660 })
    closeOfDay(db, TUE)
    closeOfDay(db, WED)
    const late = aTrader(db, { startedOn: THU })
    setPrices(db, THU, { SPY: 693 })
    closeOfDay(db, THU)
    expect(metrics(index, THU).return_pct).toBe(10.88)
    expect(metrics(late, THU)).toMatchObject({ return_pct: 0, index_return_pct: 5, vs_index_pct: -5 })
  })

  test('drawdown is the fall from the highest value so far', () => {
    const t = aTrader(db, { rules: { position_cap_pct: 100 } })
    decide(t, MON, [buy('AAPL', 1000)])
    bell(TUE)
    setPrices(db, TUE, { AAPL: [200, 240] })
    setPrices(db, WED, { AAPL: 180 })
    setPrices(db, THU, { AAPL: 210 })
    for (const d of [MON, TUE, WED, THU]) closeOfDay(db, d)
    expect(metrics(t, WED)).toMatchObject({ drawdown_pct: 25, max_drawdown_pct: 25 })
    expect(metrics(t, THU)).toMatchObject({ drawdown_pct: 12.5, max_drawdown_pct: 25, return_pct: 5 })
  })

  test('risk appetite: cash share, positions, largest position and positions over the cap', () => {
    const t = aTrader(db)
    decide(t, MON, [buy('AAPL', 200), buy('MSFT', 100)])
    bell(TUE)
    setPrices(db, TUE, { AAPL: [200, 300] })
    closeOfDay(db, TUE)
    // AAPL is now $300 of $1,100: past the 20% cap through a price rise, which is allowed but flagged.
    expect(metrics(t, TUE)).toMatchObject({ cash_share_pct: 63.64, positions: 2, largest_position_pct: 27.27, over_cap_positions: 1 })
  })

  test('activity and discipline: trades, turnover, orders and rule breaks', () => {
    const t = aTrader(db)
    decide(t, MON, [buy('AAPL', 500), buy('ZZZZ', 10), buy('MSFT', 100)])
    closeOfDay(db, MON)
    expect(metrics(t, MON)).toMatchObject({ orders_placed: 3, rule_breaks: 2, trades: 0 })
    bell(TUE)
    closeOfDay(db, TUE)
    expect(metrics(t, TUE)).toMatchObject({ trades: 2, turnover_pct: 30, rule_breaks: 0 })
  })

  test('mistake handling: adding to a loser, cutting a loser and how long it was held', () => {
    const t = aTrader(db)
    decide(t, MON, [buy('NVDA', 100), buy('AAPL', 100)])
    bell(TUE)
    setPrices(db, WED, { NVDA: [700, 700] })
    decide(t, TUE, [buy('NVDA', 50)])
    bell(WED)
    closeOfDay(db, WED)
    expect(metrics(t, WED)).toMatchObject({ added_to_loser: 1, avg_holding_days: 1 })
    setPrices(db, THU, { NVDA: [600, 600] })
    decide(t, WED, [buy('NVDA', 20)])
    bell(THU)
    closeOfDay(db, THU)
    expect(metrics(t, THU)).toMatchObject({ added_to_loser: 1, losers_cut: 0 })
    decide(t, THU, [sell('NVDA', 'all')])
    setPrices(db, FRI, { NVDA: 600 })
    bell(FRI)
    closeOfDay(db, FRI)
    const m = metrics(t, FRI)
    expect(m).toMatchObject({ losers_cut: 1, days_to_cut_loser: 3, positions: 1, avg_holding_days: 3 })
  })

  test('running the close again rewrites the same rows', () => {
    const t = aTrader(db)
    closeOfDay(db, MON)
    closeOfDay(db, MON)
    expect(db.query('SELECT COUNT(*) AS n FROM snapshots WHERE trader_id = ?').get(t)).toEqual({ n: 1 })
    expect(metrics(t, MON)).toMatchObject({ return_pct: 0, cash_share_pct: 100, positions: 0, largest_position_pct: 0 })
  })
})
