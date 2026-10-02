// Standings and badges. A standings table ranks one track (the daily or the
// weekly Traders, plus The Index) by return over a period: a day, a week, a
// month, or since the start. Each row also carries behaviour (worst drop, cash
// share, trades, rule breaks) so a lucky gambler can't hide behind its return.
//
// Badges go to AI Traders for a week or a month. They are written when the
// period ends (the floor-runner step calls awardBadges), so a finished week
// keeps its badges even if the rules for them change later.
import { firstTradingDayOfWeek, isLastTradingDayOfWeek, nextTradingDay, previousTradingDay, tradingDaysBetween } from './calendar.js'

/** @typedef {import('bun:sqlite').Database} Database */
/** @typedef {'day' | 'week' | 'month' | 'all'} PeriodKind */

/** @param {number} n */
const round2 = (n) => Math.round(n * 100) / 100 + 0

/**
 * The first trading day of the period that ends on `end`; null for 'all'
 * (each Trader's own start).
 * @param {Database} db
 * @param {PeriodKind} kind
 * @param {string} end
 * @returns {string | null}
 */
export function periodStart(db, kind, end) {
  if (kind === 'day') return end
  if (kind === 'week') return firstTradingDayOfWeek(db, end)
  if (kind === 'month') return tradingDaysBetween(db, `${end.slice(0, 7)}-01`, end)[0] ?? null
  return null
}

/**
 * @typedef {object} StandingRow
 * @property {number} rank
 * @property {number} traderId
 * @property {string} name
 * @property {'ai' | 'benchmark'} kind
 * @property {'daily' | 'weekly'} cadence
 * @property {number | null} colourSlot
 * @property {string} status
 * @property {number} totalMicro value at the period's last close
 * @property {number} returnPct over the period
 * @property {number | null} vsIndexPct the period's return less The Index's over the same dates
 * @property {number} sinceStartPct
 * @property {number} maxDrawdownPct the worst fall from a high within the period
 * @property {number} cashSharePct at the period's last close
 * @property {number} trades fills in the period
 * @property {number} ruleBreaks orders the Compliance Desk trimmed or rejected in the period
 */

/**
 * @typedef {object} TraderRow
 * @property {number} id
 * @property {string} name
 * @property {'ai' | 'benchmark'} kind
 * @property {'daily' | 'weekly'} cadence
 * @property {number | null} colour_slot
 * @property {string} status
 * @property {string} started_on
 */

/**
 * One Trader's figures over [start, end].
 * @param {Database} db
 * @param {TraderRow} t
 * @param {string | null} start null: since the Trader's own start
 * @param {string} end
 */
function periodFigures(db, t, start, end) {
  const totalOn = db.prepare('SELECT total_micro FROM snapshots WHERE trader_id = ? AND trading_date = ?')
  const endRow = /** @type {{ total_micro: number } | null} */ (totalOn.get(t.id, end))
  if (!endRow) return null
  const before = start ? previousTradingDay(db, start) : null
  const baseRow = before ? /** @type {{ total_micro: number } | null} */ (totalOn.get(t.id, before)) : null
  const startCash = /** @type {{ v: number }} */ (db.query("SELECT COALESCE(SUM(amount_micro), 0) AS v FROM cash_ledger WHERE trader_id = ? AND kind = 'start'").get(t.id)).v
  const base = baseRow?.total_micro ?? startCash
  const from = start ?? '0000-01-01'

  const totals = db.query('SELECT total_micro FROM snapshots WHERE trader_id = ? AND trading_date BETWEEN ? AND ? ORDER BY trading_date').values(t.id, from, end).map(([v]) => Number(v))
  let peak = base
  let worst = 0
  for (const total of totals) {
    peak = Math.max(peak, total)
    worst = Math.max(worst, peak ? (peak - total) / peak : 0)
  }
  /** @param {string} key */
  const metricAt = (key) => /** @type {{ value: number } | null} */ (db.query('SELECT value FROM metrics WHERE trader_id = ? AND trading_date = ? AND key = ?').get(t.id, end, key))?.value ?? 0
  /** @param {string} key */
  const metricSum = (key) => /** @type {{ v: number }} */ (db.query('SELECT COALESCE(SUM(value), 0) AS v FROM metrics WHERE trader_id = ? AND trading_date BETWEEN ? AND ? AND key = ?').get(t.id, from, end, key)).v
  const held = /** @type {{ v: number | null }} */ (db.query("SELECT MAX(value) AS v FROM metrics WHERE trader_id = ? AND trading_date BETWEEN ? AND ? AND key = 'positions'").get(t.id, from, end)).v ?? 0
  const cut = /** @type {{ n: number, days: number }} */ (db.query(`SELECT COALESCE(SUM(c.value), 0) AS n, COALESCE(SUM(c.value * d.value), 0) AS days FROM metrics c
      JOIN metrics d ON d.trader_id = c.trader_id AND d.trading_date = c.trading_date AND d.key = 'days_to_cut_loser'
      WHERE c.trader_id = ? AND c.trading_date BETWEEN ? AND ? AND c.key = 'losers_cut'`).get(t.id, from, end))

  return {
    // The close the return is measured from: the one before the period, or
    // null when there is none (the Trader started within it).
    baseDate: baseRow ? before : null,
    totalMicro: endRow.total_micro,
    returnPct: base ? round2((endRow.total_micro / base - 1) * 100) : 0,
    sinceStartPct: metricAt('return_pct'),
    maxDrawdownPct: round2(worst * 100),
    cashSharePct: metricAt('cash_share_pct'),
    trades: /** @type {{ n: number }} */ (db.query('SELECT COUNT(*) AS n FROM fills WHERE trader_id = ? AND trading_date BETWEEN ? AND ?').get(t.id, from, end)).n,
    ruleBreaks: metricSum('rule_breaks'),
    heldShares: held > 0,
    daysToCutLoser: cut.n ? cut.days / cut.n : null,
  }
}

/**
 * @param {Database} db
 * @param {string} where SQL condition on traders t
 * @param {unknown[]} params
 * @returns {TraderRow[]}
 */
const tradersWhere = (db, where, params) =>
  /** @type {TraderRow[]} */ (db.query(`SELECT id, name, kind, cadence, colour_slot, status, started_on FROM traders t WHERE ${where} ORDER BY id`).all(.../** @type {any[]} */ (params)))

/**
 * The Index's return over the same dates as one Trader's, as indexReturn() in
 * metrics.js does it: from the close the Trader's return starts at, or, for a
 * Trader that started within the period, from The Index's close before its first
 * day (its starting cash if the Trader started no later than The Index).
 * @param {Database} db
 * @param {{ t: TraderRow, f: NonNullable<ReturnType<typeof periodFigures>> }} index
 * @param {TraderRow} t
 * @param {string | null} baseDate
 * @returns {number | null}
 */
function indexReturnFor(db, index, t, baseDate) {
  const totalOn = (/** @type {string | null} */ d) =>
    d === null ? null : (/** @type {{ total_micro: number } | null} */ (db.query('SELECT total_micro FROM snapshots WHERE trader_id = ? AND trading_date = ?').get(index.t.id, d))?.total_micro ?? null)
  const startCash = () => /** @type {{ v: number }} */ (db.query("SELECT COALESCE(SUM(amount_micro), 0) AS v FROM cash_ledger WHERE trader_id = ? AND kind = 'start'").get(index.t.id)).v
  const base = baseDate !== null ? totalOn(baseDate) ?? startCash()
    : t.started_on <= index.t.started_on ? startCash()
    : totalOn(previousTradingDay(db, t.started_on))
  return base ? round2((index.f.totalMicro / base - 1) * 100) : null
}

/**
 * The standings table for one track over a period.
 * @param {Database} db
 * @param {{ track: 'daily' | 'weekly', kind: PeriodKind, end: string }} options
 * @returns {StandingRow[]}
 */
export function standings(db, { track, kind, end }) {
  const start = periodStart(db, kind, end)
  const traders = tradersWhere(db, "(t.kind = 'benchmark' OR t.cadence = ?) AND t.started_on <= ?", [track, end])
  const rows = traders.flatMap((t) => {
    const f = periodFigures(db, t, start, end)
    return f ? [{ t, f }] : []
  })
  const index = rows.find((r) => r.t.kind === 'benchmark')
  const vsIndex = (/** @type {TraderRow} */ t, /** @type {NonNullable<ReturnType<typeof periodFigures>>} */ f) => {
    const ix = index ? indexReturnFor(db, index, t, f.baseDate) : null
    return ix === null ? null : round2(f.returnPct - ix)
  }
  rows.sort((a, b) => b.f.returnPct - a.f.returnPct || a.t.name.localeCompare(b.t.name))
  /** @type {StandingRow[]} */
  const out = []
  rows.forEach(({ t, f }, i) => {
    // Equal returns share a rank.
    const rank = i > 0 && f.returnPct === rows[i - 1].f.returnPct ? out[i - 1].rank : i + 1
    out.push({
      rank,
      traderId: t.id,
      name: t.name,
      kind: t.kind,
      cadence: t.cadence,
      colourSlot: t.colour_slot,
      status: t.status,
      totalMicro: f.totalMicro,
      returnPct: f.returnPct,
      vsIndexPct: vsIndex(t, f),
      sinceStartPct: f.sinceStartPct,
      maxDrawdownPct: f.maxDrawdownPct,
      cashSharePct: f.cashSharePct,
      trades: f.trades,
      ruleBreaks: f.ruleBreaks,
    })
  })
  return out
}

/**
 * @typedef {object} Badge
 * @property {string} badge
 * @property {number} traderId
 * @property {string} name
 */

/**
 * Each badge: who may get it, and the value to rank them by (higher is better).
 * A badge needs `min` candidates, and is not given when every AI Trader shares it.
 * @type {Array<{ badge: string, min: number, score: (f: NonNullable<ReturnType<typeof periodFigures>>) => number | null }>}
 */
const BADGES = [
  { badge: 'Top return', min: 1, score: (f) => f.returnPct },
  { badge: 'Most active', min: 1, score: (f) => (f.trades > 0 ? f.trades : null) },
  { badge: 'Biggest cash pile', min: 1, score: (f) => (f.cashSharePct > 0 ? f.cashSharePct : null) },
  { badge: 'Steadiest', min: 2, score: (f) => (f.heldShares ? -f.maxDrawdownPct : null) },
  { badge: 'Fastest loss-cutter', min: 1, score: (f) => (f.daysToCutLoser === null ? null : -f.daysToCutLoser) },
]

/**
 * Work out a period's badges without storing them.
 * @param {Database} db
 * @param {'week' | 'month'} kind
 * @param {string} end
 * @returns {Badge[]}
 */
function computeBadges(db, kind, end) {
  const start = periodStart(db, kind, end)
  const figures = tradersWhere(db, "t.kind = 'ai' AND t.started_on <= ?", [end])
    .map((t) => ({ t, f: periodFigures(db, t, start, end) }))
    .filter((x) => x.f !== null)
  /** @type {Badge[]} */
  const out = []
  for (const { badge, min, score } of BADGES) {
    const scored = figures.map((x) => ({ ...x, s: score(/** @type {any} */ (x.f)) })).filter((x) => x.s !== null)
    if (scored.length < min) continue
    const best = Math.max(...scored.map((x) => /** @type {number} */ (x.s)))
    const winners = scored.filter((x) => x.s === best)
    if (winners.length === figures.length) continue
    for (const w of winners) out.push({ badge, traderId: w.t.id, name: w.t.name })
  }
  return out
}

/**
 * Store a finished period's badges (again, if the step re-runs).
 * @param {Database} db
 * @param {'week' | 'month'} kind
 * @param {string} end the period's last trading day
 * @returns {Badge[]}
 */
export function awardBadges(db, kind, end) {
  const badges = computeBadges(db, kind, end)
  db.transaction(() => {
    db.run('DELETE FROM badges WHERE period_kind = ? AND period_end = ?', [kind, end])
    const insert = db.prepare('INSERT INTO badges (period_kind, period_end, badge, trader_id) VALUES (?, ?, ?, ?)')
    for (const b of badges) insert.run(kind, end, b.badge, b.traderId)
  })()
  return badges
}

/**
 * A period's badges: as stored once it ended, or worked out so far.
 * @param {Database} db
 * @param {'week' | 'month'} kind
 * @param {string} end
 * @returns {Badge[]}
 */
export function badgesFor(db, kind, end) {
  const stored = /** @type {Array<{ badge: string, traderId: number, name: string }>} */ (
    db.query('SELECT b.badge, b.trader_id AS traderId, t.name FROM badges b JOIN traders t ON t.id = b.trader_id WHERE b.period_kind = ? AND b.period_end = ?').all(kind, end)
  )
  if (!stored.length) return computeBadges(db, kind, end)
  const order = BADGES.map((b) => b.badge)
  return stored.sort((a, b) => order.indexOf(a.badge) - order.indexOf(b.badge) || a.traderId - b.traderId)
}

/**
 * At a day's close: store the week's badges on its last trading day, and the month's on its last.
 * @param {Database} db
 * @param {string} date
 */
export function awardBadgesAtClose(db, date) {
  if (isLastTradingDayOfWeek(db, date)) awardBadges(db, 'week', date)
  const next = nextTradingDay(db, date)
  if (next === null || next.slice(0, 7) !== date.slice(0, 7)) awardBadges(db, 'month', date)
}
