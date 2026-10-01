import { beforeEach, describe, expect, test } from 'bun:test'
import { checkBooks } from '../core/books.js'
import { checkOrders } from '../core/complianceDesk.js'
import { ringOpeningBell } from '../core/openingBell.js'
import { toMicro } from '../core/money.js'
import { cashOf, positionsOf } from '../core/portfolio.js'
import { retireTrader } from '../core/traders.js'
import { aTrader, anIndex, buy, instrumentId, NOW, sell, setPrices, tradingDb } from './trading-fixture.js'

/** @type {import('bun:sqlite').Database} */
let db

const MON = '2026-11-02'
const TUE = '2026-11-03'
const WED = '2026-11-04'
const THU = '2026-11-05'

/** @param {number} traderId @param {string} date @param {any[]} orders */
const decide = (traderId, date, orders) => checkOrders(db, { traderId, date, orders, now: NOW })
/** @param {string} date */
const bell = (date) => ringOpeningBell(db, { date, now: NOW })
/** @param {number} traderId */
const held = (traderId) => Object.fromEntries(positionsOf(db, traderId).map((p) => [p.ticker, p.quantity_micro]))
/** @param {number} orderId */
const order = (orderId) => /** @type {{ status: string, fill_note: string | null }} */ (db.query('SELECT status, fill_note FROM orders WHERE id = ?').get(orderId))

beforeEach(() => {
  db = tradingDb()
  for (const d of [MON, TUE, WED, THU]) setPrices(db, d, { AAPL: 200, MSFT: 400, NVDA: 800, SPY: 600, TLT: 90 })
})

describe('Opening Bell', () => {
  test('fills at the official open, in fractional shares, and books cash and position together', () => {
    const t = aTrader(db)
    setPrices(db, TUE, { AAPL: [250, 260] })
    const [v] = decide(t, MON, [buy('AAPL', 200)])
    expect(bell(TUE)).toMatchObject({ filled: 1, scaled: 0, cancelled: 0 })
    expect(db.query('SELECT side, price_micro, quantity_micro, amount_micro, trading_date FROM fills').get()).toEqual({ side: 'buy', price_micro: toMicro(250), quantity_micro: 800_000, amount_micro: toMicro(200), trading_date: TUE })
    expect(cashOf(db, t)).toBe(toMicro(800))
    expect(positionsOf(db, t)).toEqual([{ instrument_id: instrumentId(db, 'AAPL'), ticker: 'AAPL', quantity_micro: 800_000, cost_basis_micro: toMicro(200) }])
    expect(order(v.orderId).status).toBe('filled')
  })

  test('ringing twice for a day fills nothing twice', () => {
    const t = aTrader(db)
    decide(t, MON, [buy('AAPL', 200)])
    bell(TUE)
    expect(bell(TUE).filled).toBe(0)
    expect(db.query('SELECT COUNT(*) AS n FROM fills').get()).toEqual({ n: 1 })
  })

  test('fills sells before buys, so the proceeds pay for the buys', () => {
    const t = aTrader(db, { cash: 200, rules: { position_cap_pct: 100 } })
    decide(t, MON, [buy('AAPL', 200)])
    bell(TUE)
    decide(t, TUE, [buy('MSFT', 200), sell('AAPL', 'all')])
    bell(WED)
    expect(db.query('SELECT side FROM fills WHERE trading_date = ? ORDER BY id').values(WED).flat()).toEqual(['sell', 'buy'])
    expect(held(t)).toEqual({ MSFT: 500_000 })
    expect(cashOf(db, t)).toBe(0)
  })

  test('scales a buy down when a gap at the open leaves less cash than expected', () => {
    const t = aTrader(db, { rules: { position_cap_pct: 100 } })
    decide(t, MON, [buy('AAPL', 1000)])
    bell(TUE)
    const [, b] = decide(t, TUE, [sell('AAPL', 'all'), buy('MSFT', 1000)])
    setPrices(db, WED, { AAPL: [180, 180] })
    expect(bell(WED)).toMatchObject({ filled: 2, scaled: 1 })
    expect(cashOf(db, t)).toBe(0)
    expect(held(t)).toEqual({ MSFT: 2_250_000 })
    expect(order(b.orderId)).toEqual({ status: 'filled', fill_note: 'Prices moved at the open, so the buy was scaled down from $1,000.00 to $900.00 to fit the cash and the 100% position cap.' })
  })

  test('scales a buy down when a gap at the open would break the position cap', () => {
    const t = aTrader(db)
    decide(t, MON, [buy('AAPL', 150)])
    bell(TUE)
    const [v] = decide(t, TUE, [buy('AAPL', 50)])
    expect(v.verdict).toBe('accepted')
    // AAPL opens 40% higher: 0.75 shares are worth $210 of $1,060, leaving $2 of room under the $212 cap.
    setPrices(db, WED, { AAPL: [280, 280] })
    bell(WED)
    // $2 buys 0.007142 shares at $280, which cost $1.99976.
    expect(db.query('SELECT quantity_micro, amount_micro FROM fills WHERE trading_date = ?').get(WED)).toEqual({ quantity_micro: 7_142, amount_micro: 1_999_760 })
    expect(order(v.orderId).fill_note).toContain('scaled down from $50.00 to $2.00')
  })

  test('cancels an order when there is no opening price', () => {
    const t = aTrader(db)
    const [v] = decide(t, MON, [buy('NVDA', 100)])
    db.run('DELETE FROM daily_bars WHERE instrument_id = ? AND date = ?', [instrumentId(db, 'NVDA'), TUE])
    expect(bell(TUE).cancelled).toBe(1)
    expect(order(v.orderId)).toEqual({ status: 'cancelled', fill_note: 'There was no opening price for NVDA on 2026-11-03, so the order was cancelled.' })
    expect(cashOf(db, t)).toBe(toMicro(1000))
  })

  test('a stock split multiplies the shares held, once, and scales queued sells', () => {
    const t = aTrader(db)
    decide(t, MON, [buy('NVDA', 200)])
    bell(TUE)
    const [v] = decide(t, TUE, [sell('NVDA', 'all')])
    db.run("INSERT INTO corporate_actions (instrument_id, kind, ex_date, split_from, split_to) VALUES (?, 'split', ?, 1, 4)", [instrumentId(db, 'NVDA'), WED])
    setPrices(db, WED, { NVDA: [200, 210] })
    expect(bell(WED).splits).toBe(1)
    expect(db.query("SELECT amount_micro, note FROM cash_ledger WHERE kind = 'split'").get()).toEqual({ amount_micro: 0, note: 'NVDA split 4-for-1: 0.25 shares became 1.' })
    // The queued "sell all" sold all four-times-as-many shares at the new price.
    expect(db.query('SELECT quantity_micro, amount_micro FROM fills WHERE order_id = ?').get(v.orderId)).toEqual({ quantity_micro: 1_000_000, amount_micro: toMicro(200) })
    expect(bell(WED).splits).toBe(0)
    expect(checkBooks(db)).toEqual([])
  })

  test('pays a dividend to whoever held the stock at the close before the ex-date, once', () => {
    const t = aTrader(db)
    decide(t, MON, [buy('SPY', 150)])
    bell(TUE)
    db.run("INSERT INTO corporate_actions (instrument_id, kind, ex_date, cash_per_share_micro) VALUES (?, 'dividend', ?, ?)", [instrumentId(db, 'SPY'), WED, toMicro(2)])
    expect(bell(WED).dividends).toBe(1)
    expect(bell(WED).dividends).toBe(0)
    expect(db.query("SELECT amount_micro, note FROM cash_ledger WHERE kind = 'dividend'").get()).toEqual({ amount_micro: toMicro(0.5), note: 'SPY dividend of $2.00 a share on 0.25 shares.' })
  })

  test('The Index buys SPY with all its cash at the first open, and reinvests dividends', () => {
    const index = anIndex(db, { startedOn: TUE })
    setPrices(db, TUE, { SPY: [625, 630] })
    bell(MON)
    expect(held(index)).toEqual({})
    bell(TUE)
    expect(held(index)).toEqual({ SPY: 1_600_000 })
    expect(cashOf(db, index)).toBe(0)
    db.run("INSERT INTO corporate_actions (instrument_id, kind, ex_date, cash_per_share_micro) VALUES (?, 'dividend', ?, ?)", [instrumentId(db, 'SPY'), WED, toMicro(2.5)])
    setPrices(db, WED, { SPY: [640, 640] })
    bell(WED)
    expect(held(index)).toEqual({ SPY: 1_600_000 + 6_250 })
    expect(cashOf(db, index)).toBe(0)
    expect(checkBooks(db)).toEqual([])
  })

  test('a retired Trader sells everything at the next open, then is marked retired', () => {
    const t = aTrader(db)
    const [, queuedBuy] = decide(t, MON, [buy('AAPL', 200), buy('MSFT', 100)])
    bell(TUE)
    decide(t, TUE, [buy('NVDA', 100)])
    expect(retireTrader(db, t, { date: TUE, now: NOW })).toBe(2)
    expect(db.query("SELECT COUNT(*) AS n FROM orders WHERE status = 'cancelled'").get()).toEqual({ n: 1 })
    expect(order(queuedBuy.orderId).status).toBe('filled')
    const result = bell(WED)
    expect(result.retired).toEqual([t])
    expect(held(t)).toEqual({})
    expect(cashOf(db, t)).toBe(toMicro(1000))
    expect(db.query('SELECT status, retired_on FROM traders WHERE id = ?').get(t)).toEqual({ status: 'retired', retired_on: WED })
  })

  test('the books balance after a run of trades, and a tampered position is caught', () => {
    const t = aTrader(db)
    decide(t, MON, [buy('AAPL', 200), buy('MSFT', 150)])
    bell(TUE)
    setPrices(db, WED, { AAPL: [190, 195] })
    decide(t, TUE, [sell('AAPL', 50), buy('NVDA', 120)])
    bell(WED)
    decide(t, WED, [sell('MSFT', 'all')])
    bell(THU)
    expect(checkBooks(db)).toEqual([])
    db.run("UPDATE positions SET quantity_micro = quantity_micro + 1 WHERE instrument_id = ?", [instrumentId(db, 'AAPL')])
    expect(checkBooks(db)).toHaveLength(1)
  })
})
