import { beforeEach, describe, expect, test } from 'bun:test'
import { checkOrders } from '../core/complianceDesk.js'
import { ringOpeningBell } from '../core/openingBell.js'
import { toMicro } from '../core/money.js'
import { aTrader, buy, NOW, sell, setPrices, tradingDb } from './trading-fixture.js'

/** @type {import('bun:sqlite').Database} */
let db

const MON = '2026-11-02'
const TUE = '2026-11-03'

/** @param {number} traderId @param {any[]} orders @param {object} [extra] */
const check = (traderId, orders, extra = {}) => checkOrders(db, { traderId, runId: null, date: MON, orders, now: NOW, ...extra })

beforeEach(() => {
  db = tradingDb()
  setPrices(db, MON, { AAPL: 200, MSFT: 400, NVDA: 800, SPY: 600, TLT: 90 })
  setPrices(db, TUE, { AAPL: 200, MSFT: 400, NVDA: 800, SPY: 600, TLT: 90 })
})

describe('Compliance Desk', () => {
  test('accepts a buy that fits, and queues it for the next open', () => {
    const t = aTrader(db)
    const [v] = check(t, [buy('AAPL', 150)])
    expect(v).toMatchObject({ verdict: 'accepted', note: null, approvedAmountMicro: toMicro(150) })
    expect(db.query('SELECT status, fill_on, decided_on, reason FROM orders WHERE id = ?').get(v.orderId)).toEqual({ status: 'queued', fill_on: TUE, decided_on: MON, reason: 'test' })
  })

  test('trims a buy to the 20% position cap', () => {
    const t = aTrader(db)
    const [v] = check(t, [buy('AAPL', 500)])
    expect(v.verdict).toBe('trimmed')
    expect(v.approvedAmountMicro).toBe(toMicro(200))
    expect(v.note).toBe('It asked for $500.00: trimmed to $200.00 so AAPL stays within the 20% position cap.')
  })

  test('counts what is already held toward the cap, at the latest close', () => {
    const t = aTrader(db)
    check(t, [buy('AAPL', 120)])
    ringOpeningBell(db, { date: TUE, now: NOW })
    // AAPL rises to $250 at Tuesday's close: the $120 holding is now worth $150 of $1,030.
    setPrices(db, TUE, { AAPL: [200, 250] })
    const [v] = checkOrders(db, { traderId: t, date: TUE, orders: [buy('AAPL', 100)], now: NOW })
    expect(v.verdict).toBe('trimmed')
    expect(v.approvedAmountMicro).toBe(toMicro(56))
  })

  test('rejects a buy when the cap is already reached', () => {
    const t = aTrader(db)
    const [, second] = check(t, [buy('AAPL', 200), buy('AAPL', 10)])
    expect(second.verdict).toBe('rejected')
    expect(second.note).toContain('already at the 20% position cap')
  })

  test('trims buys to the cash available, in the order given', () => {
    const t = aTrader(db, { rules: { position_cap_pct: 60 } })
    const [a, b, c] = check(t, [buy('AAPL', 600), buy('MSFT', 600), buy('NVDA', 10)])
    expect(a.verdict).toBe('accepted')
    expect(b).toMatchObject({ verdict: 'trimmed', approvedAmountMicro: toMicro(400), note: 'It asked for $600.00: trimmed to $400.00, the cash available.' })
    expect(c.verdict).toBe('rejected')
    expect(c.note).toContain('no cash left')
  })

  test('rejects unknown and off-menu tickers, and buys without an amount', () => {
    db.run("UPDATE instruments SET on_menu = 0 WHERE ticker = 'TLT'")
    const t = aTrader(db)
    const [unknown, offMenu, noAmount] = check(t, [buy('ZZZZ', 100), buy('TLT', 100), { side: 'buy', ticker: 'AAPL', reason: 'x' }])
    expect(unknown).toMatchObject({ verdict: 'rejected', note: "ZZZZ isn't a ticker the desk knows, so it can't be bought." })
    expect(offMenu).toMatchObject({ verdict: 'rejected', note: "TLT isn't on the stock menu, so it can't be bought." })
    expect(noAmount.verdict).toBe('rejected')
    expect(db.query("SELECT COUNT(*) AS n FROM orders WHERE status = 'rejected'").get()).toEqual({ n: 3 })
    expect(db.query("SELECT instrument_id FROM orders WHERE ticker = 'ZZZZ'").get()).toEqual({ instrument_id: null })
  })

  test('tidies tickers the way a Trader might write them', () => {
    const t = aTrader(db)
    const [v] = check(t, [buy(' aapl ', 100)])
    expect(v).toMatchObject({ ticker: 'AAPL', verdict: 'accepted' })
  })

  test('rejects selling what it does not hold (no short selling)', () => {
    const t = aTrader(db)
    const [v] = check(t, [sell('AAPL', 100)])
    expect(v.verdict).toBe('rejected')
    expect(v.note).toContain("selling shares you don't own (short selling) isn't allowed")
  })

  test('resolves "sell all" to the shares held, and trims a sell to what is held', () => {
    const t = aTrader(db)
    check(t, [buy('AAPL', 200), buy('MSFT', 200)])
    ringOpeningBell(db, { date: TUE, now: NOW })
    const [all, over] = checkOrders(db, { traderId: t, date: TUE, orders: [sell('AAPL', 'all'), sell('MSFT', 300)], now: NOW })
    expect(all).toMatchObject({ verdict: 'accepted', approvedQtyMicro: 1_000_000, approvedAmountMicro: toMicro(200) })
    expect(over).toMatchObject({ verdict: 'trimmed', approvedQtyMicro: 500_000 })
    expect(over.note).toBe('It asked to sell $300.00 but holds only $200.00 of MSFT, so the order was trimmed to everything it holds.')
  })

  test('counts sale proceeds before checking buys', () => {
    const t = aTrader(db, { cash: 200, rules: { position_cap_pct: 100 } })
    check(t, [buy('AAPL', 200)])
    ringOpeningBell(db, { date: TUE, now: NOW })
    const [, b] = checkOrders(db, { traderId: t, date: TUE, orders: [buy('MSFT', 200), sell('AAPL', 'all')], now: NOW })
    expect(b.verdict).toBe('accepted')
  })

  test('a dry run records the verdicts but queues nothing', () => {
    const t = aTrader(db)
    const [v] = check(t, [buy('AAPL', 500)], { dryRun: true })
    expect(v.verdict).toBe('trimmed')
    expect(db.query('SELECT status FROM orders').all()).toEqual([{ status: 'dry_run' }])
    expect(ringOpeningBell(db, { date: TUE, now: NOW }).filled).toBe(0)
  })

  test('takes a per-trade cost out of the cash available', () => {
    const t = aTrader(db, { cash: 100, rules: { position_cap_pct: 100, per_trade_cost_micro: toMicro(1) } })
    const [v] = check(t, [buy('AAPL', 100)])
    expect(v).toMatchObject({ verdict: 'trimmed', approvedAmountMicro: toMicro(99) })
  })
})
