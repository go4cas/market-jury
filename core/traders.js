// Joining and leaving the experiment: a new Trader gets its starting cash, The
// Index is a Trader of kind benchmark, and a retiring Trader sells everything
// at the next open.
import { nextTradingDay } from './calendar.js'
import { DEFAULT_RULES, positionsOf } from './portfolio.js'

/** @typedef {import('bun:sqlite').Database} Database */

export const INDEX_NAME = 'The Index'
export const INDEX_TICKER = 'SPY'

/**
 * @typedef {object} NewTrader
 * @property {string} name
 * @property {'ai' | 'benchmark'} [kind]
 * @property {number | null} [modelId]
 * @property {'daily' | 'weekly'} cadence
 * @property {number | null} [colourSlot]
 * @property {string} startedOn the trading date its cash arrives: for a Trader, the evening of its
 *   first decision; for The Index, the open after it (day one), when it buys SPY
 * @property {number} cashMicro starting cash
 * @property {Partial<import('./portfolio.js').Rules>} [rules]
 * @property {Date} now
 */

/**
 * Add a Trader with fresh cash and its rule set.
 * @param {Database} db
 * @param {NewTrader} t
 * @returns {number} the Trader's id
 */
export function createTrader(db, { name, kind = 'ai', modelId = null, cadence, colourSlot = null, startedOn, cashMicro, rules = {}, now }) {
  return db.transaction(() => {
    const { id } = /** @type {{ id: number }} */ (
      db.query(`INSERT INTO traders (name, kind, model_id, cadence, colour_slot, started_on) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
        .get(name, kind, modelId, cadence, colourSlot, startedOn)
    )
    db.run('INSERT INTO rule_sets (trader_id, rules, effective_from) VALUES (?, ?, ?)', [id, JSON.stringify({ ...DEFAULT_RULES, ...rules }), startedOn])
    db.run("INSERT INTO cash_ledger (trader_id, kind, amount_micro, trading_date, note, created_at) VALUES (?, 'start', ?, ?, 'Starting cash', ?)", [id, cashMicro, startedOn, now.toISOString()])
    return id
  })()
}

/**
 * Create The Index: it holds SPY from day one, so the Opening Bell spends its
 * cash on SPY at the first open (and reinvests every dividend). It has no
 * position cap because holding one fund is the whole idea.
 * @param {Database} db
 * @param {{ startedOn: string, cashMicro: number, now: Date }} options
 */
export function createIndex(db, { startedOn, cashMicro, now }) {
  return createTrader(db, { name: INDEX_NAME, kind: 'benchmark', cadence: 'daily', startedOn, cashMicro, rules: { position_cap_pct: 100 }, now })
}

/**
 * Retire a Trader: queued buys are cancelled and every position is queued to
 * sell at the next open. The Opening Bell marks it retired once it holds only cash.
 * @param {Database} db
 * @param {number} traderId
 * @param {{ date: string, now: Date }} options date: the trading date of the decision
 * @returns {number} sell orders queued
 */
export function retireTrader(db, traderId, { date, now }) {
  const fillOn = nextTradingDay(db, date)
  return db.transaction(() => {
    db.run("UPDATE traders SET status = 'retiring' WHERE id = ? AND status = 'active'", [traderId])
    db.run("UPDATE orders SET status = 'cancelled', fill_note = 'Cancelled because the Trader was retired.' WHERE trader_id = ? AND status = 'queued'", [traderId])
    const insert = db.prepare(`INSERT INTO orders (trader_id, instrument_id, ticker, side, sell_all, reason, verdict, approved_qty_micro, decided_on, fill_on, status, created_at)
      VALUES (?, ?, ?, 'sell', 1, 'The Trader was retired, so everything it holds is sold at the next open.', 'accepted', ?, ?, ?, 'queued', ?)`)
    const positions = positionsOf(db, traderId)
    for (const p of positions) insert.run(traderId, p.instrument_id, p.ticker, p.quantity_micro, date, fillOn, now.toISOString())
    return positions.length
  })()
}
