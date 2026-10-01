// End of day: what every Trader is worth at the close (snapshots) and how it
// is behaving (metrics). Both are written per Trader per trading day, and
// rewriting a day gives the same rows, so the step can safely run again.
//
// Metrics are rows keyed by name, so a new metric is a new key. Percentages
// have two decimals. Measures over a period (rule breaks per month, change in
// risk appetite after a winning week) are read from these daily rows.
import { previousTradingDay, tradingDaysBetween } from './calendar.js'
import { share } from './money.js'
import { cashOf, closeOn, rulesFor, valuePortfolio } from './portfolio.js'
import { positionsAsOf, replay } from './books.js'
import { INDEX_NAME } from './traders.js'

/** @typedef {import('bun:sqlite').Database} Database */

/**
 * @typedef {object} TraderRow
 * @property {number} id
 * @property {string} name
 * @property {string} kind
 * @property {string} started_on
 */

/**
 * Traders taking part on `date`: started on or before it, not retired before it.
 * @param {Database} db
 * @param {string} date
 * @returns {TraderRow[]}
 */
function tradersOn(db, date) {
  return /** @type {TraderRow[]} */ (
    db.query('SELECT id, name, kind, started_on FROM traders WHERE started_on <= ?1 AND (retired_on IS NULL OR retired_on >= ?1) ORDER BY id').all(date)
  )
}

/**
 * Snapshot and measure every Trader at the close of `date`.
 * @param {Database} db
 * @param {string} date a trading day whose closing prices are stored
 * @returns {{ traders: number }}
 */
export function closeOfDay(db, date) {
  const traders = tradersOn(db, date)
  db.transaction(() => {
    // Snapshots first: the Index comparison reads the Index's snapshot.
    for (const t of traders) takeSnapshot(db, t.id, date)
    for (const t of traders) writeMetrics(db, t, date)
  })()
  return { traders: traders.length }
}

/**
 * @param {Database} db
 * @param {number} traderId
 * @param {string} date
 */
export function takeSnapshot(db, traderId, date) {
  const v = valueAtClose(db, traderId, date)
  db.run(`INSERT INTO snapshots (trader_id, trading_date, cash_micro, holdings_micro, total_micro) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (trader_id, trading_date) DO UPDATE SET cash_micro = excluded.cash_micro, holdings_micro = excluded.holdings_micro, total_micro = excluded.total_micro`,
    [traderId, date, v.cash, v.holdings, v.total])
  return v
}

/**
 * A portfolio as it stood at the close of `date`, at that day's closing prices.
 * @param {Database} db
 * @param {number} traderId
 * @param {string} date
 */
export const valueAtClose = (db, traderId, date) =>
  valuePortfolio(cashOf(db, traderId, date), positionsAsOf(db, traderId, date), (id) => closeOn(db, id, date))

/** @param {number} n */
const round2 = (n) => Math.round(n * 100) / 100

/**
 * @param {Database} db
 * @param {TraderRow} trader
 * @param {string} date
 * @returns {Record<string, number>}
 */
export function metricsFor(db, trader, date) {
  const value = valueAtClose(db, trader.id, date)
  const rules = rulesFor(db, trader.id, date)
  const start = startingValue(db, trader.id)
  const totals = /** @type {number[]} */ (
    db.query('SELECT total_micro FROM snapshots WHERE trader_id = ? AND trading_date <= ? ORDER BY trading_date').values(trader.id, date).map(([v]) => Number(v))
  )

  /** @type {Record<string, number>} */
  const m = {}
  m.return_pct = start ? round2((value.total / start - 1) * 100) : 0
  const index = indexReturn(db, trader, date)
  if (index !== null) {
    m.index_return_pct = index
    m.vs_index_pct = round2(m.return_pct - index)
  }

  // Drawdown: the fall from the highest value so far (the start counts as a peak).
  let peak = start
  let maxDrawdown = 0
  for (const total of totals) {
    peak = Math.max(peak, total)
    maxDrawdown = Math.max(maxDrawdown, peak ? (peak - total) / peak : 0)
  }
  m.drawdown_pct = peak ? round2(((peak - value.total) / peak) * 100) : 0
  m.max_drawdown_pct = round2(maxDrawdown * 100)

  // Risk appetite.
  m.cash_share_pct = share(value.cash, value.total)
  m.positions = value.positions.length
  m.largest_position_pct = share(Math.max(0, ...value.positions.map((p) => p.value_micro)), value.total)
  m.over_cap_positions = value.positions.filter((p) => share(p.value_micro, value.total) > rules.position_cap_pct).length

  // Activity and discipline.
  const traded = /** @type {{ n: number, amount: number }} */ (
    db.query('SELECT COUNT(*) AS n, COALESCE(SUM(amount_micro), 0) AS amount FROM fills WHERE trader_id = ? AND trading_date = ?').get(trader.id, date)
  )
  m.trades = traded.n
  m.turnover_pct = share(traded.amount, value.total)
  const placed = /** @type {{ n: number, breaks: number }} */ (
    db.query(`SELECT COUNT(*) AS n, COALESCE(SUM(verdict <> 'accepted'), 0) AS breaks FROM orders
              WHERE trader_id = ? AND decided_on = ? AND run_id IS NOT NULL AND status <> 'dry_run'`).get(trader.id, date)
  )
  m.orders_placed = placed.n
  m.rule_breaks = placed.breaks

  // Holding period and mistake handling, from a replay of the fills.
  const { lots, fills } = replay(db, trader.id, date)
  const daysSince = (/** @type {string} */ from) => tradingDaysBetween(db, from, date).length - 1
  const ages = [...lots.values()].map((lot) => daysSince(lot.openedOn))
  m.avg_holding_days = ages.length ? round2(ages.reduce((a, b) => a + b, 0) / ages.length) : 0

  const today = fills.filter((f) => f.date === date)
  // Buying more of something that is already below what was paid for it.
  m.added_to_loser = today.filter((f) => f.side === 'buy' && f.before && BigInt(f.priceMicro) * BigInt(f.before.quantity_micro) < BigInt(f.before.cost_basis_micro) * 1_000_000n).length
  // Closing a position for less than it cost, and how long it was held first.
  const cut = today.filter((f) => f.side === 'sell' && f.before && f.quantityMicro >= f.before.quantity_micro && f.amountMicro < f.before.cost_basis_micro)
  m.losers_cut = cut.length
  if (cut.length) m.days_to_cut_loser = round2(cut.reduce((sum, f) => sum + daysSince(/** @type {import('./books.js').Lot} */ (f.before).openedOn), 0) / cut.length)
  return m
}

/**
 * @param {Database} db
 * @param {TraderRow} trader
 * @param {string} date
 */
function writeMetrics(db, trader, date) {
  const upsert = db.prepare('INSERT INTO metrics (trader_id, trading_date, key, value) VALUES (?, ?, ?, ?) ON CONFLICT (trader_id, trading_date, key) DO UPDATE SET value = excluded.value')
  for (const [key, value] of Object.entries(metricsFor(db, trader, date))) upsert.run(trader.id, date, key, value)
}

/**
 * What a Trader started with.
 * @param {Database} db
 * @param {number} traderId
 */
function startingValue(db, traderId) {
  const row = /** @type {{ v: number }} */ (db.query("SELECT COALESCE(SUM(amount_micro), 0) AS v FROM cash_ledger WHERE trader_id = ? AND kind = 'start'").get(traderId))
  return row.v
}

/**
 * The Index's return over the same dates as this Trader: from the Index's
 * value at the close before the Trader started (or the Index's own start) to
 * this close, so a late joiner is compared over its own dates.
 * @param {Database} db
 * @param {TraderRow} trader
 * @param {string} date
 * @returns {number | null}
 */
function indexReturn(db, trader, date) {
  const index = /** @type {TraderRow | null} */ (db.query("SELECT id, name, kind, started_on FROM traders WHERE kind = 'benchmark' AND name = ?").get(INDEX_NAME))
  if (!index) return null
  const totalOn = (/** @type {string | null} */ d) =>
    d === null ? null : (/** @type {{ total_micro: number } | null} */ (db.query('SELECT total_micro FROM snapshots WHERE trader_id = ? AND trading_date = ?').get(index.id, d))?.total_micro ?? null)
  const base = trader.started_on <= index.started_on ? startingValue(db, index.id) : totalOn(previousTradingDay(db, trader.started_on))
  const now = totalOn(date)
  if (!base || now === null) return null
  return round2((now / base - 1) * 100)
}
