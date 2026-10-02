// The Compliance Desk: checks a Trader's orders against its rules at the
// latest close, trims or rejects anything that breaks them, and queues the
// rest for the next open. Every trim or rejection carries a plain reason and
// counts as a rule break.
//
// In order (tech spec): unknown or off-menu buys are rejected; sells of shares
// not held are rejected; "sell all" is resolved to the held quantity; buys are
// trimmed to the position cap, then to the cash available (sells counted first).
import { nextTradingDay } from './calendar.js'
import { mulDiv, usd, valueOf } from './money.js'
import { positionsAsOf } from './books.js'
import { cashOf, closeOn, rulesFor, valuePortfolio } from './portfolio.js'

/** @typedef {import('bun:sqlite').Database} Database */

/**
 * An order as a Trader writes it (after schema parsing).
 * @typedef {object} RequestedOrder
 * @property {'buy' | 'sell'} side
 * @property {string} ticker
 * @property {number | null} [amountMicro] dollars to buy or sell; ignored with sellAll
 * @property {boolean} [sellAll]
 * @property {string} reason the Trader's own words, kept verbatim
 */

/**
 * @typedef {object} Verdict
 * @property {number} orderId
 * @property {string} ticker
 * @property {'buy' | 'sell'} side
 * @property {'accepted' | 'trimmed' | 'rejected'} verdict
 * @property {string | null} note why it was trimmed or rejected
 * @property {number | null} approvedAmountMicro dollars (estimated at the close for sells)
 * @property {number | null} approvedQtyMicro micro-shares, for sells
 */

/**
 * @param {Database} db
 * @param {{ traderId: number, runId?: number | null, date: string, orders: RequestedOrder[], dryRun?: boolean, now: Date }} options
 *   date: the trading date the decision was made on (its close is the reference price)
 * @returns {Verdict[]} one per order, in the order given
 */
export function checkOrders(db, { traderId, runId = null, date, orders, dryRun = false, now }) {
  const rules = rulesFor(db, traderId, date)
  const fillOn = nextTradingDay(db, date)
  const fee = rules.per_trade_cost_micro
  const instrumentFor = db.prepare('SELECT id, on_menu FROM instruments WHERE ticker = ?')

  // The books as they stood at that close, even when the check runs later.
  const positions = positionsAsOf(db, traderId, date)
  const portfolio = valuePortfolio(cashOf(db, traderId, date), positions, (id) => closeOn(db, id, date))
  // What the Trader holds (micro-shares) and is worth per ticker, as orders are worked through.
  const held = new Map(portfolio.positions.map((p) => [p.instrument_id, p.quantity_micro]))
  const valueHeld = new Map(portfolio.positions.map((p) => [p.instrument_id, p.value_micro]))
  const capMicro = mulDiv(portfolio.total, Math.round(rules.position_cap_pct * 100), 10_000)
  let cash = portfolio.cash

  /** @type {Array<Omit<Verdict, 'orderId'> & { instrumentId: number | null, request: RequestedOrder }>} */
  const results = orders.map((o) => ({ request: o, ticker: String(o.ticker ?? '').trim().toUpperCase(), side: o.side, instrumentId: null, verdict: 'accepted', note: null, approvedAmountMicro: null, approvedQtyMicro: null }))
  const reject = (/** @type {typeof results[number]} */ r, /** @type {string} */ note) => Object.assign(r, { verdict: 'rejected', note, approvedAmountMicro: null, approvedQtyMicro: null })

  // Sells first, so their proceeds can pay for buys.
  for (const r of results.filter((x) => x.side === 'sell')) {
    const inst = /** @type {{ id: number, on_menu: number } | null} */ (instrumentFor.get(r.ticker))
    r.instrumentId = inst?.id ?? null
    const have = inst ? (held.get(inst.id) ?? 0) : 0
    if (have <= 0) {
      reject(r, `It doesn't hold any ${r.ticker || 'shares of that ticker'}, and selling shares you don't own (short selling) isn't allowed.`)
      continue
    }
    const price = /** @type {number} */ (closeOn(db, /** @type {number} */ (r.instrumentId), date))
    let qty = have
    if (!r.request.sellAll) {
      const amount = r.request.amountMicro ?? 0
      if (!(amount > 0)) {
        reject(r, 'The order gave no dollar amount to sell.')
        continue
      }
      qty = mulDiv(amount, 1_000_000, price)
      if (qty > have) {
        qty = have
        r.verdict = 'trimmed'
        r.note = `It asked to sell ${usd(amount)} but holds only ${usd(valueOf(have, price))} of ${r.ticker}, so the order was trimmed to everything it holds.`
      }
      if (qty <= 0) {
        reject(r, 'The amount is too small to sell any part of a share.')
        continue
      }
    }
    const proceeds = valueOf(qty, price)
    held.set(/** @type {number} */ (r.instrumentId), have - qty)
    valueHeld.set(/** @type {number} */ (r.instrumentId), valueOf(have - qty, price))
    cash += proceeds - fee
    r.approvedQtyMicro = qty
    r.approvedAmountMicro = proceeds
  }

  for (const r of results.filter((x) => x.side === 'buy')) {
    const inst = /** @type {{ id: number, on_menu: number } | null} */ (instrumentFor.get(r.ticker))
    r.instrumentId = inst?.id ?? null
    const amount = r.request.amountMicro ?? 0
    if (!inst) {
      reject(r, `${r.ticker || 'That ticker'} isn't a ticker the desk knows, so it can't be bought.`)
      continue
    }
    if (inst.on_menu !== 1) {
      reject(r, `${r.ticker} isn't on the stock menu, so it can't be bought.`)
      continue
    }
    if (closeOn(db, inst.id, date) === null) {
      reject(r, `There is no price for ${r.ticker} yet, so it can't be bought.`)
      continue
    }
    if (!(amount > 0)) {
      reject(r, 'The order gave no dollar amount to buy.')
      continue
    }
    const room = capMicro - (valueHeld.get(inst.id) ?? 0)
    if (room <= 0) {
      reject(r, `${r.ticker} is already at the ${rules.position_cap_pct}% position cap, the most one ticker may be of the portfolio.`)
      continue
    }
    if (cash - fee <= 0) {
      reject(r, 'There is no cash left for this buy, and borrowing to buy (leverage) isn\'t allowed.')
      continue
    }
    let approved = amount
    const notes = []
    if (approved > room) {
      approved = room
      notes.push(`trimmed to ${usd(room)} so ${r.ticker} stays within the ${rules.position_cap_pct}% position cap`)
    }
    if (approved > cash - fee) {
      approved = cash - fee
      notes.push(`trimmed to ${usd(approved)}, the cash available`)
    }
    if (notes.length) {
      r.verdict = 'trimmed'
      r.note = `It asked for ${usd(amount)}: ${notes.join(', then ')}.`
    }
    r.approvedAmountMicro = approved
    cash -= approved + fee
    valueHeld.set(inst.id, (valueHeld.get(inst.id) ?? 0) + approved)
  }

  const insert = db.prepare(`INSERT INTO orders (run_id, trader_id, instrument_id, ticker, side, amount_micro, sell_all, reason, verdict, verdict_note,
      approved_amount_micro, approved_qty_micro, decided_on, fill_on, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
  return db.transaction(() =>
    results.map((r) => {
      const status = dryRun ? 'dry_run' : r.verdict === 'rejected' ? 'rejected' : 'queued'
      const { id } = /** @type {{ id: number }} */ (
        insert.get(runId, traderId, r.instrumentId, r.ticker || String(r.request.ticker ?? ''), r.side, r.request.sellAll ? null : (r.request.amountMicro ?? null),
          r.request.sellAll ? 1 : 0, String(r.request.reason ?? ''), r.verdict, r.note, r.approvedAmountMicro, r.approvedQtyMicro, date, fillOn, status, now.toISOString())
      )
      return { orderId: id, ticker: r.ticker, side: r.side, verdict: r.verdict, note: r.note, approvedAmountMicro: r.approvedAmountMicro, approvedQtyMicro: r.approvedQtyMicro }
    }),
  )()
}
