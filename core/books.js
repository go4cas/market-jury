// Replaying a Trader's history. Positions are a running total kept by the
// Opening Bell; this rebuilds them from scratch, from fills and recorded
// splits, to check the running totals and to answer questions the totals
// can't, such as when a position was opened or what it cost before a buy.
import { mulDiv } from './money.js'
import { cashOf, costAfterSale, positionsOf } from './portfolio.js'

/** @typedef {import('bun:sqlite').Database} Database */

/**
 * @typedef {object} Lot
 * @property {number} quantity_micro
 * @property {number} cost_basis_micro
 * @property {string} openedOn trading date of the buy that opened it (from zero shares)
 */

/**
 * @typedef {object} FillEvent
 * @property {number} fillId
 * @property {number} instrumentId
 * @property {'buy' | 'sell'} side
 * @property {string} date
 * @property {number} priceMicro
 * @property {number} quantityMicro
 * @property {number} amountMicro
 * @property {Lot | null} before the position just before this fill
 */

/**
 * @param {Database} db
 * @param {number} traderId
 * @param {string} [through] replay up to and including this trading date
 * @returns {{ lots: Map<number, Lot>, fills: FillEvent[] }}
 */
export function replay(db, traderId, through = '9999-12-31') {
  // Splits happen before the open, so on the same date they come before fills.
  const events = /** @type {Array<{ type: 'split' | 'fill', date: string, id: number, instrument_id: number, side: 'buy' | 'sell' | null, price_micro: number | null, quantity_micro: number | null, amount_micro: number | null, split_from: number | null, split_to: number | null }>} */ (
    db.query(`SELECT 'split' AS type, l.trading_date AS date, l.id, c.instrument_id, NULL AS side, NULL AS price_micro, NULL AS quantity_micro, NULL AS amount_micro, c.split_from, c.split_to, 0 AS rank
              FROM cash_ledger l JOIN corporate_actions c ON c.id = l.corporate_action_id
              WHERE l.trader_id = ?1 AND l.kind = 'split' AND l.trading_date <= ?2
              UNION ALL
              SELECT 'fill', trading_date, id, instrument_id, side, price_micro, quantity_micro, amount_micro, NULL, NULL, 1
              FROM fills WHERE trader_id = ?1 AND trading_date <= ?2
              ORDER BY date, rank, id`).all(traderId, through)
  )
  /** @type {Map<number, Lot>} */
  const lots = new Map()
  /** @type {FillEvent[]} */
  const fills = []
  for (const e of events) {
    const lot = lots.get(e.instrument_id)
    if (e.type === 'split') {
      if (lot) lot.quantity_micro = mulDiv(lot.quantity_micro, /** @type {number} */ (e.split_to), /** @type {number} */ (e.split_from))
      continue
    }
    const qty = /** @type {number} */ (e.quantity_micro)
    const amount = /** @type {number} */ (e.amount_micro)
    fills.push({ fillId: e.id, instrumentId: e.instrument_id, side: /** @type {'buy' | 'sell'} */ (e.side), date: e.date, priceMicro: /** @type {number} */ (e.price_micro), quantityMicro: qty, amountMicro: amount, before: lot ? { ...lot } : null })
    if (e.side === 'buy') {
      if (lot) {
        lot.quantity_micro += qty
        lot.cost_basis_micro += amount
      } else lots.set(e.instrument_id, { quantity_micro: qty, cost_basis_micro: amount, openedOn: e.date })
    } else if (lot) {
      const left = lot.quantity_micro - qty
      if (left > 0) {
        lot.cost_basis_micro = costAfterSale(lot, qty)
        lot.quantity_micro = left
      } else lots.delete(e.instrument_id)
    }
  }
  return { lots, fills }
}

/**
 * The positions a Trader held at the close of `date`, rebuilt from its fills,
 * so a past day can be valued (or valued again) correctly.
 * @param {Database} db
 * @param {number} traderId
 * @param {string} date
 * @returns {import('./portfolio.js').Position[]}
 */
export function positionsAsOf(db, traderId, date) {
  const tickers = new Map(db.query('SELECT id, ticker FROM instruments').values().map(([id, t]) => [Number(id), String(t)]))
  return [...replay(db, traderId, date).lots].map(([id, lot]) => ({ instrument_id: id, ticker: tickers.get(id) ?? '', quantity_micro: lot.quantity_micro, cost_basis_micro: lot.cost_basis_micro }))
}

/**
 * Compare every Trader's stored positions with a replay of its fills, and its
 * cash with its ledger. An empty list means the books balance.
 * @param {Database} db
 * @returns {string[]} plain-language mismatches
 */
export function checkBooks(db) {
  const problems = []
  const traders = /** @type {Array<{ id: number, name: string }>} */ (db.query('SELECT id, name FROM traders ORDER BY id').all())
  for (const t of traders) {
    const { lots } = replay(db, t.id)
    const stored = new Map(positionsOf(db, t.id).map((p) => [p.instrument_id, p]))
    for (const id of new Set([...lots.keys(), ...stored.keys()])) {
      const a = lots.get(id)
      const b = stored.get(id)
      if (a?.quantity_micro !== b?.quantity_micro || a?.cost_basis_micro !== b?.cost_basis_micro) {
        problems.push(`${t.name}: ${b?.ticker ?? `instrument ${id}`} is stored as ${b?.quantity_micro ?? 0} micro-shares costing ${b?.cost_basis_micro ?? 0}, but its fills add up to ${a?.quantity_micro ?? 0} costing ${a?.cost_basis_micro ?? 0}.`)
      }
    }
    if (cashOf(db, t.id) < 0) problems.push(`${t.name} has negative cash.`)
  }
  return problems
}
