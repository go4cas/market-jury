// A Trader's books: cash (the sum of its cash ledger), positions, rules and
// what it is all worth at a given price. Every other part of the trading engine
// reads portfolios through these functions.
import { valueOf } from './money.js'

/** @typedef {import('bun:sqlite').Database} Database */

/**
 * @typedef {object} Rules
 * @property {boolean} long_only
 * @property {number} leverage_limit 1 means no borrowing
 * @property {number} position_cap_pct the most one ticker may be of the portfolio, at purchase
 * @property {number} per_trade_cost_micro charged on every fill
 */

/** v1 uses the same guardrails for every Trader (PRD: Trading rules). */
export const DEFAULT_RULES = Object.freeze({ long_only: true, leverage_limit: 1, position_cap_pct: 20, per_trade_cost_micro: 0 })

/**
 * The rule set in force for a Trader on a date: the latest one that took effect
 * on or before it, over the defaults.
 * @param {Database} db
 * @param {number} traderId
 * @param {string} date
 * @returns {Rules}
 */
export function rulesFor(db, traderId, date) {
  const row = /** @type {{ rules: string } | null} */ (
    db.query('SELECT rules FROM rule_sets WHERE trader_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1').get(traderId, date)
  )
  return { ...DEFAULT_RULES, ...(row ? JSON.parse(row.rules) : {}) }
}

/**
 * Cash on hand: every ledger movement added up, optionally only up to a date.
 * @param {Database} db
 * @param {number} traderId
 * @param {string} [through] trading date, inclusive
 */
export function cashOf(db, traderId, through = '9999-12-31') {
  const row = /** @type {{ cash: number }} */ (
    db.query('SELECT COALESCE(SUM(amount_micro), 0) AS cash FROM cash_ledger WHERE trader_id = ? AND trading_date <= ?').get(traderId, through)
  )
  return row.cash
}

/**
 * @typedef {object} Position
 * @property {number} instrument_id
 * @property {string} ticker
 * @property {number} quantity_micro
 * @property {number} cost_basis_micro what was paid for the shares still held
 */

/**
 * @param {Database} db
 * @param {number} traderId
 * @returns {Position[]}
 */
export function positionsOf(db, traderId) {
  return /** @type {Position[]} */ (
    db.query(`SELECT p.instrument_id, i.ticker, p.quantity_micro, p.cost_basis_micro
              FROM positions p JOIN instruments i ON i.id = p.instrument_id
              WHERE p.trader_id = ? AND p.direction = 'long' AND p.quantity_micro > 0
              ORDER BY i.ticker`).all(traderId)
  )
}

/**
 * The official open on exactly `date`, or null when there is no bar that day.
 * @param {Database} db
 * @param {number} instrumentId
 * @param {string} date
 * @returns {number | null}
 */
export function openOn(db, instrumentId, date) {
  const row = /** @type {{ open_micro: number } | null} */ (db.query('SELECT open_micro FROM daily_bars WHERE instrument_id = ? AND date = ?').get(instrumentId, date))
  return row?.open_micro ?? null
}

/**
 * The latest final close on or before `date` (a halted stock keeps its last
 * price). A bar saved at the open has no final close yet, so it is passed over.
 * @param {Database} db
 * @param {number} instrumentId
 * @param {string} date
 * @returns {number | null}
 */
export function closeOn(db, instrumentId, date) {
  const row = /** @type {{ close_micro: number } | null} */ (
    db.query("SELECT close_micro FROM daily_bars WHERE instrument_id = ? AND date <= ? AND source <> 'alpaca-open' ORDER BY date DESC LIMIT 1").get(instrumentId, date)
  )
  return row?.close_micro ?? null
}

/**
 * @typedef {object} Valuation
 * @property {number} cash
 * @property {number} holdings
 * @property {number} total
 * @property {Array<Position & { price_micro: number | null, value_micro: number }>} positions
 */

/**
 * What a portfolio is worth at the given prices (a held ticker without a price counts as 0).
 * @param {number} cash
 * @param {Position[]} positions
 * @param {(instrumentId: number) => number | null} priceOf
 * @returns {Valuation}
 */
export function valuePortfolio(cash, positions, priceOf) {
  const valued = positions.map((p) => {
    const price = priceOf(p.instrument_id)
    return { ...p, price_micro: price, value_micro: price === null ? 0 : valueOf(p.quantity_micro, price) }
  })
  const holdings = valued.reduce((sum, p) => sum + p.value_micro, 0)
  return { cash, holdings, total: cash + holdings, positions: valued }
}

/**
 * The cost basis left after selling part of a position: average cost, so the
 * shares sold take their proportional share of what was paid.
 * @param {{ quantity_micro: number, cost_basis_micro: number }} position
 * @param {number} soldMicro
 */
export function costAfterSale(position, soldMicro) {
  if (soldMicro >= position.quantity_micro) return 0
  const q = BigInt(position.quantity_micro)
  const soldCost = (BigInt(position.cost_basis_micro) * BigInt(soldMicro) + q / 2n) / q
  return position.cost_basis_micro - Number(soldCost)
}
