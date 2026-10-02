// The Opening Bell: fills queued orders at the official opening price of their
// fill date. Before any fill, the day's stock splits change share counts and
// dividends are paid to whoever held the stock at the previous close. Sells
// fill before buys so their proceeds can pay for purchases; a buy that no
// longer fits the cash or the position cap after a price gap is scaled down,
// not rejected. The Index then spends any cash it has on SPY.
//
// Running it twice for a day changes nothing: filled orders are no longer
// queued, and each split or dividend is recorded once per Trader in the ledger.
// When earlier opens were skipped (a pause), the splits and dividends whose
// ex-dates fell in the gap are applied at this open, before any fill: nobody
// traded in between, so the holdings are the ones that earned them.
import { mulDiv, usd, valueOf } from './money.js'
import { previousTradingDay } from './calendar.js'
import { cashOf, closeOn, costAfterSale, openOn, positionsOf, rulesFor, valuePortfolio } from './portfolio.js'
import { INDEX_TICKER } from './traders.js'

/** @typedef {import('bun:sqlite').Database} Database */

/** The Index leaves less than this in cash rather than buy a sliver of SPY. */
const INDEX_MIN_BUY_MICRO = 1_000_000

/**
 * @typedef {object} BellResult
 * @property {number} filled
 * @property {number} scaled
 * @property {number} cancelled
 * @property {number} splits Trader positions adjusted for a split
 * @property {number} dividends dividend payments credited
 * @property {number[]} retired Traders that finished retiring
 */

/**
 * @param {Database} db
 * @param {{ date: string, now: Date, since?: string | null }} options date: the trading day whose open fills the orders;
 *   since: the last day whose open did ring (default: the trading day before), so ex-dates after it are applied now
 * @returns {BellResult}
 */
export function ringOpeningBell(db, { date, now, since }) {
  const at = now.toISOString()
  const after = since ?? previousTradingDay(db, date) ?? new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  /** @type {BellResult} */
  const result = { filled: 0, scaled: 0, cancelled: 0, splits: 0, dividends: 0, retired: [] }

  db.transaction(() => {
    result.splits = applySplits(db, after, date, at)
    result.dividends = payDividends(db, after, date, at)

    const traders = /** @type {Array<{ trader_id: number }>} */ (
      db.query("SELECT DISTINCT trader_id FROM orders WHERE status = 'queued' AND fill_on = ? ORDER BY trader_id").all(date)
    )
    for (const { trader_id } of traders) fillTrader(db, trader_id, date, at, result)

    const indexes = /** @type {Array<{ id: number }>} */ (
      db.query("SELECT id FROM traders WHERE kind = 'benchmark' AND status = 'active' AND started_on <= ?").all(date)
    )
    for (const { id } of indexes) investIndex(db, id, date, at, result)

    const retiring = /** @type {Array<{ id: number }>} */ (
      db.query(`SELECT id FROM traders t WHERE status = 'retiring'
                AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.trader_id = t.id AND p.quantity_micro > 0)
                AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.trader_id = t.id AND o.status = 'queued')`).all()
    )
    for (const { id } of retiring) {
      db.run("UPDATE traders SET status = 'retired', retired_on = ? WHERE id = ?", [date, id])
      result.retired.push(id)
    }
  })()
  return result
}

/**
 * A split multiplies the shares held (4-for-1: 10 shares become 40) and leaves
 * what was paid unchanged. Sells already queued for that ticker scale too.
 * @param {Database} db
 * @param {string} after ex-dates after this day...
 * @param {string} date ...up to this one
 * @param {string} at
 */
function applySplits(db, after, date, at) {
  const splits = /** @type {Array<{ id: number, instrument_id: number, ticker: string, split_from: number, split_to: number }>} */ (
    db.query(`SELECT c.id, c.instrument_id, i.ticker, c.split_from, c.split_to FROM corporate_actions c JOIN instruments i ON i.id = c.instrument_id
              WHERE c.kind = 'split' AND c.ex_date > ? AND c.ex_date <= ? AND c.split_from > 0 AND c.split_to > 0 ORDER BY c.ex_date, c.id`).all(after, date)
  )
  let applied = 0
  for (const s of splits) {
    const holders = /** @type {Array<{ trader_id: number, quantity_micro: number }>} */ (
      db.query(`SELECT trader_id, quantity_micro FROM positions p WHERE instrument_id = ? AND quantity_micro > 0
                AND NOT EXISTS (SELECT 1 FROM cash_ledger l WHERE l.trader_id = p.trader_id AND l.corporate_action_id = ?)`).all(s.instrument_id, s.id)
    )
    for (const h of holders) {
      const after = mulDiv(h.quantity_micro, s.split_to, s.split_from)
      db.run("UPDATE positions SET quantity_micro = ? WHERE trader_id = ? AND instrument_id = ? AND direction = 'long'", [after, h.trader_id, s.instrument_id])
      db.run(`UPDATE orders SET approved_qty_micro = approved_qty_micro * ? / ?
              WHERE trader_id = ? AND instrument_id = ? AND side = 'sell' AND status = 'queued' AND fill_on >= ?`, [s.split_to, s.split_from, h.trader_id, s.instrument_id, date])
      db.run("INSERT INTO cash_ledger (trader_id, kind, amount_micro, trading_date, corporate_action_id, note, created_at) VALUES (?, 'split', 0, ?, ?, ?, ?)", [
        h.trader_id, date, s.id,
        `${s.ticker} split ${s.split_to}-for-${s.split_from}: ${shares(h.quantity_micro)} shares became ${shares(after)}.`, at,
      ])
      applied++
    }
  }
  return applied
}

/**
 * Dividends go to whoever held the stock at the close before the ex-date,
 * credited on the ex-date (v1 does not wait for the pay date).
 * @param {Database} db
 * @param {string} after ex-dates after this day...
 * @param {string} date ...up to this one
 * @param {string} at
 */
function payDividends(db, after, date, at) {
  const dividends = /** @type {Array<{ id: number, instrument_id: number, ticker: string, cash_per_share_micro: number }>} */ (
    db.query(`SELECT c.id, c.instrument_id, i.ticker, c.cash_per_share_micro FROM corporate_actions c JOIN instruments i ON i.id = c.instrument_id
              WHERE c.kind = 'dividend' AND c.ex_date > ? AND c.ex_date <= ? AND c.cash_per_share_micro > 0 ORDER BY c.ex_date, c.id`).all(after, date)
  )
  let paid = 0
  for (const d of dividends) {
    const holders = /** @type {Array<{ trader_id: number, quantity_micro: number }>} */ (
      db.query(`SELECT trader_id, quantity_micro FROM positions p WHERE instrument_id = ? AND quantity_micro > 0
                AND NOT EXISTS (SELECT 1 FROM cash_ledger l WHERE l.trader_id = p.trader_id AND l.corporate_action_id = ?)`).all(d.instrument_id, d.id)
    )
    for (const h of holders) {
      const amount = valueOf(h.quantity_micro, d.cash_per_share_micro)
      db.run("INSERT INTO cash_ledger (trader_id, kind, amount_micro, trading_date, corporate_action_id, note, created_at) VALUES (?, 'dividend', ?, ?, ?, ?, ?)", [
        h.trader_id, amount, date, d.id, `${d.ticker} dividend of ${usd(d.cash_per_share_micro)} a share on ${shares(h.quantity_micro)} shares.`, at,
      ])
      paid++
    }
  }
  return paid
}

/**
 * @typedef {object} QueuedOrder
 * @property {number} id
 * @property {number | null} instrument_id
 * @property {string} ticker
 * @property {'buy' | 'sell'} side
 * @property {number | null} approved_amount_micro
 * @property {number | null} approved_qty_micro
 */

/**
 * @param {Database} db
 * @param {number} traderId
 * @param {string} date
 * @param {string} at
 * @param {BellResult} result
 */
function fillTrader(db, traderId, date, at, result) {
  const rules = rulesFor(db, traderId, date)
  const fee = rules.per_trade_cost_micro
  const orders = /** @type {QueuedOrder[]} */ (
    db.query(`SELECT id, instrument_id, ticker, side, approved_amount_micro, approved_qty_micro FROM orders
              WHERE trader_id = ? AND status = 'queued' AND fill_on = ? ORDER BY side = 'buy', id`).all(traderId, date)
  )
  const cancel = (/** @type {QueuedOrder} */ o, /** @type {string} */ note) => {
    db.run("UPDATE orders SET status = 'cancelled', fill_note = ? WHERE id = ?", [note, o.id])
    result.cancelled++
  }

  for (const o of orders.filter((x) => x.side === 'sell')) {
    const price = o.instrument_id === null ? null : openOn(db, o.instrument_id, date)
    const position = positionsOf(db, traderId).find((p) => p.instrument_id === o.instrument_id)
    if (price === null) {
      cancel(o, `There was no opening price for ${o.ticker} on ${date}, so the order was cancelled.`)
      continue
    }
    if (!position) {
      cancel(o, `It no longer held any ${o.ticker} at the open, so there was nothing to sell.`)
      continue
    }
    const qty = Math.min(o.approved_qty_micro ?? 0, position.quantity_micro)
    if (qty <= 0) {
      cancel(o, 'There was nothing left to sell at the open.')
      continue
    }
    // No borrowing, even for the trading cost: a sale can't take cash below zero.
    const amount = valueOf(qty, price)
    const sellFee = Math.max(0, Math.min(fee, cashOf(db, traderId) + amount))
    fill(db, { traderId, order: o, price, qty, amount, fee: sellFee, date, at })
    if (sellFee < fee) db.run('UPDATE orders SET fill_note = ? WHERE id = ?', [`The trading cost was cut to ${usd(sellFee)}, all the cash there was, so the sale couldn't leave cash below zero.`, o.id])
    result.filled++
  }

  // Buys are checked again at the open: prices may have gapped since the close.
  const priceAtOpen = (/** @type {number} */ id) => openOn(db, id, date) ?? closeOn(db, id, date)
  const atOpen = valuePortfolio(cashOf(db, traderId, date), positionsOf(db, traderId), priceAtOpen)
  const capMicro = mulDiv(atOpen.total, Math.round(rules.position_cap_pct * 100), 10_000)
  const valueHeld = new Map(atOpen.positions.map((p) => [p.instrument_id, p.value_micro]))
  let cash = atOpen.cash

  for (const o of orders.filter((x) => x.side === 'buy')) {
    const price = o.instrument_id === null ? null : openOn(db, o.instrument_id, date)
    if (price === null || o.instrument_id === null) {
      cancel(o, `There was no opening price for ${o.ticker} on ${date}, so the order was cancelled.`)
      continue
    }
    const wanted = o.approved_amount_micro ?? 0
    const amount = Math.min(wanted, capMicro - (valueHeld.get(o.instrument_id) ?? 0), cash - fee)
    const qty = amount > 0 ? mulDiv(amount, 1_000_000, price) : 0
    if (qty <= 0) {
      cancel(o, `Prices moved at the open, leaving no room for this buy within the cash and the ${rules.position_cap_pct}% position cap, so it was cancelled.`)
      continue
    }
    const cost = valueOf(qty, price)
    fill(db, { traderId, order: o, price, qty, amount: cost, fee, date, at })
    if (amount < wanted) {
      db.run('UPDATE orders SET fill_note = ? WHERE id = ?', [`Prices moved at the open, so the buy was scaled down from ${usd(wanted)} to ${usd(cost)} to fit the cash and the ${rules.position_cap_pct}% position cap.`, o.id])
      result.scaled++
    }
    cash -= cost + fee
    valueHeld.set(o.instrument_id, (valueHeld.get(o.instrument_id) ?? 0) + cost)
    result.filled++
  }
}

/**
 * The Index spends whatever cash it has (its starting cash on day one,
 * dividends later) on SPY at the open.
 * @param {Database} db
 * @param {number} traderId
 * @param {string} date
 * @param {string} at
 * @param {BellResult} result
 */
function investIndex(db, traderId, date, at, result) {
  const spy = /** @type {{ id: number } | null} */ (db.query('SELECT id FROM instruments WHERE ticker = ?').get(INDEX_TICKER))
  const price = spy ? openOn(db, spy.id, date) : null
  const cash = cashOf(db, traderId, date)
  if (!spy || price === null || cash < INDEX_MIN_BUY_MICRO) return
  const qty = mulDiv(cash, 1_000_000, price)
  const amount = valueOf(qty, price)
  const { id } = /** @type {{ id: number }} */ (
    db.query(`INSERT INTO orders (trader_id, instrument_id, ticker, side, amount_micro, reason, verdict, approved_amount_micro, decided_on, fill_on, status, created_at)
              VALUES (?, ?, ?, 'buy', ?, 'The Index puts all its cash into SPY and holds it.', 'accepted', ?, ?, ?, 'queued', ?) RETURNING id`)
      .get(traderId, spy.id, INDEX_TICKER, cash, cash, date, date, at)
  )
  fill(db, { traderId, order: { id, instrument_id: spy.id, side: 'buy' }, price, qty, amount, fee: 0, date, at })
  result.filled++
}

/**
 * Write one fill: the fills row, its cash movement (and fee), the updated
 * position and the order's status. Called inside the bell's transaction.
 * @param {Database} db
 * @param {{ traderId: number, order: { id: number, instrument_id: number | null, side: 'buy' | 'sell' }, price: number, qty: number, amount: number, fee: number, date: string, at: string }} f
 */
function fill(db, { traderId, order, price, qty, amount, fee, date, at }) {
  const instrumentId = /** @type {number} */ (order.instrument_id)
  const { id: fillId } = /** @type {{ id: number }} */ (
    db.query('INSERT INTO fills (order_id, trader_id, instrument_id, side, price_micro, quantity_micro, amount_micro, trading_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .get(order.id, traderId, instrumentId, order.side, price, qty, amount, date)
  )
  const signed = order.side === 'buy' ? -amount : amount
  db.run('INSERT INTO cash_ledger (trader_id, kind, amount_micro, trading_date, fill_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [traderId, order.side, signed, date, fillId, at])
  if (fee > 0) db.run("INSERT INTO cash_ledger (trader_id, kind, amount_micro, trading_date, fill_id, note, created_at) VALUES (?, 'fee', ?, ?, ?, 'Trading cost', ?)", [traderId, -fee, date, fillId, at])

  const position = /** @type {{ quantity_micro: number, cost_basis_micro: number } | null} */ (
    db.query("SELECT quantity_micro, cost_basis_micro FROM positions WHERE trader_id = ? AND instrument_id = ? AND direction = 'long'").get(traderId, instrumentId)
  )
  if (order.side === 'buy') {
    db.run(`INSERT INTO positions (trader_id, instrument_id, direction, quantity_micro, cost_basis_micro) VALUES (?, ?, 'long', ?, ?)
            ON CONFLICT (trader_id, instrument_id, direction) DO UPDATE SET quantity_micro = quantity_micro + excluded.quantity_micro, cost_basis_micro = cost_basis_micro + excluded.cost_basis_micro`,
      [traderId, instrumentId, qty, amount])
  } else if (position) {
    const left = position.quantity_micro - qty
    if (left > 0) db.run("UPDATE positions SET quantity_micro = ?, cost_basis_micro = ? WHERE trader_id = ? AND instrument_id = ? AND direction = 'long'", [left, costAfterSale(position, qty), traderId, instrumentId])
    else db.run("DELETE FROM positions WHERE trader_id = ? AND instrument_id = ? AND direction = 'long'", [traderId, instrumentId])
  }
  db.run("UPDATE orders SET status = 'filled' WHERE id = ?", [order.id])
}

/** @param {number} micro */
const shares = (micro) => (micro / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 6 })
