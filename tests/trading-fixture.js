// A small market for trading-engine tests: the real 2026 New York calendar,
// the test menu, and prices set by hand per test, in dollars.
import { toMicro } from '../core/money.js'
import { createIndex, createTrader } from '../core/traders.js'
import { saveCalendar } from '../market/store.js'
import { testDb } from './helpers.js'
import { calendar2026, TEST_MENU } from './market-fixture.js'

export const NOW = new Date('2026-11-02T12:00:00Z')

export function tradingDb() {
  const db = testDb()
  saveCalendar(db, calendar2026())
  for (const i of TEST_MENU.instruments) db.run('INSERT INTO instruments (ticker, name, asset_class, added_on) VALUES (?, ?, ?, ?)', [i.ticker, i.name, i.assetClass, '2026-01-02'])
  db.run("INSERT INTO models (provider, model_version, effort, input_micro_per_mtok, cached_input_micro_per_mtok, output_micro_per_mtok, created_at) VALUES ('anthropic', 'test-model', 'medium', 0, 0, 0, ?)", [NOW.toISOString()])
  return db
}

/** @param {import('bun:sqlite').Database} db @param {string} ticker */
export const instrumentId = (db, ticker) => /** @type {{ id: number }} */ (db.query('SELECT id FROM instruments WHERE ticker = ?').get(ticker)).id

/**
 * Set prices for a day: a number is the close (and the open), a pair is [open, close].
 * @param {import('bun:sqlite').Database} db
 * @param {string} date
 * @param {Record<string, number | [number, number]>} prices dollars
 */
export function setPrices(db, date, prices) {
  for (const [ticker, p] of Object.entries(prices)) {
    const [open, close] = Array.isArray(p) ? p : [p, p]
    db.run(`INSERT INTO daily_bars (instrument_id, date, open_micro, high_micro, low_micro, close_micro, volume, source) VALUES (?, ?, ?, ?, ?, ?, 1000, 'test')
            ON CONFLICT (instrument_id, date) DO UPDATE SET open_micro = excluded.open_micro, close_micro = excluded.close_micro`,
      [instrumentId(db, ticker), date, toMicro(open), toMicro(Math.max(open, close)), toMicro(Math.min(open, close)), toMicro(close)])
  }
}

/**
 * An AI Trader with $1,000 (or `cash` dollars) from `startedOn`.
 * @param {import('bun:sqlite').Database} db
 * @param {{ name?: string, startedOn?: string, cash?: number, rules?: object }} [options]
 */
export function aTrader(db, { name = 'Claude daily', startedOn = '2026-11-02', cash = 1000, rules = {} } = {}) {
  return createTrader(db, { name, modelId: 1, cadence: 'daily', startedOn, cashMicro: toMicro(cash), rules, now: NOW })
}

/** @param {import('bun:sqlite').Database} db @param {{ startedOn?: string, cash?: number }} [options] */
export const anIndex = (db, { startedOn = '2026-11-02', cash = 1000 } = {}) => createIndex(db, { startedOn, cashMicro: toMicro(cash), now: NOW })

/**
 * @param {string} ticker
 * @param {number} dollars
 * @param {string} [reason]
 */
export const buy = (ticker, dollars, reason = 'test') => ({ side: /** @type {const} */ ('buy'), ticker, amountMicro: toMicro(dollars), reason })

/**
 * @param {string} ticker
 * @param {number | 'all'} dollars
 * @param {string} [reason]
 */
export const sell = (ticker, dollars, reason = 'test') =>
  dollars === 'all' ? { side: /** @type {const} */ ('sell'), ticker, sellAll: true, reason } : { side: /** @type {const} */ ('sell'), ticker, amountMicro: toMicro(dollars), reason }
