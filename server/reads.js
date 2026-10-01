// Public reads: everything the Gallery screens show. Open to anyone while the
// Trade Master has the Gallery switched on, and always to the Trade Master;
// otherwise every route here refuses (fail closed). Money stays in
// micro-dollars; the client converts for display.
import { closeInstant, firstTradingDayOfWeek, isLastTradingDayOfWeek, isTradingDay, marketDate, nextTradingDay, openInstant, previousTradingDay, tradingDaysBetween } from '../core/calendar.js'
import { closeOn, positionsOf, valuePortfolio, cashOf } from '../core/portfolio.js'
import { positionsAsOf } from '../core/books.js'
import { badgesFor, periodStart, standings } from '../core/standings.js'
import { isTradeMaster } from './auth.js'
import { error, json } from './http.js'

/** @typedef {import('bun:sqlite').Database} Database */

/**
 * @param {{ db: Database, now: () => Date }} ctx
 */
export function readRoutes({ db, now }) {
  /**
   * @param {(req: Request & { params?: Record<string, string> }, url: URL) => unknown} handler returns the JSON body, or a Response
   */
  const open = (handler) => async (/** @type {Request & { params?: Record<string, string> }} */ req) => {
    if (!galleryOpen(db) && !isTradeMaster(db, req)) return error(401, 'The Gallery is closed. Log in as the Trade Master to see this.')
    const out = await handler(req, new URL(req.url))
    return out instanceof Response ? out : json(out)
  }

  return {
    '/api/overview': {
      GET: open(() => {
        const latest = latestDate(db)
        return {
          status: status(db, now()),
          movers: latest ? movers(db, latest) : [],
          standings: latest ? { daily: standings(db, { track: 'daily', kind: 'all', end: latest }), weekly: standings(db, { track: 'weekly', kind: 'all', end: latest }) } : { daily: [], weekly: [] },
          recap: db.query("SELECT kind, period_date AS date, headline, body FROM columnist_posts WHERE kind = 'daily' ORDER BY period_date DESC LIMIT 1").get() ?? null,
        }
      }),
    },

    '/api/series': { GET: open((_req, url) => series(db, track(url))) },

    '/api/standings': {
      GET: open((_req, url) => {
        const latest = latestDate(db)
        const kindParam = url.searchParams.get('kind')
        const kind = /** @type {import('../core/standings.js').PeriodKind} */ (['day', 'week', 'month', 'all'].includes(kindParam ?? '') ? kindParam : 'week')
        const end = dateParam(url.searchParams.get('end')) ?? latest
        const ends = periodEnds(db, latest)
        if (!end) return { track: track(url), kind, end: null, start: null, rows: [], badges: [], periods: ends }
        return {
          track: track(url),
          kind,
          end,
          start: periodStart(db, kind, end),
          rows: standings(db, { track: track(url), kind, end }),
          badges: kind === 'week' || kind === 'month' ? badgesFor(db, kind, end) : [],
          periods: ends,
        }
      }),
    },

    '/api/days/latest': {
      GET: open(() => {
        const date = /** @type {{ d: string | null }} */ (db.query('SELECT MAX(d.trading_date) AS d FROM decisions d JOIN runs r ON r.id = d.run_id WHERE r.dry_run = 0').get()).d
        return day(db, date)
      }),
    },
    '/api/days/:date': {
      GET: open((req) => {
        const date = dateParam(req.params?.date ?? null)
        if (!date) return error(400, 'Pick a date written as YYYY-MM-DD.')
        if (!isTradingDay(db, date)) return error(404, `${date} was not a trading day, so nobody decided anything.`)
        const latest = /** @type {{ d: string | null }} */ (db.query('SELECT MAX(d.trading_date) AS d FROM decisions d JOIN runs r ON r.id = d.run_id WHERE r.dry_run = 0').get()).d
        if (!latest || date > latest) return error(404, `The Traders have not decided anything for ${date} yet.`)
        return day(db, date)
      }),
    },

    '/api/history': { GET: open((_req, url) => history(db, track(url))) },

    '/api/traders': {
      GET: open(() => ({
        traders: db.query(`SELECT t.id, t.name, t.kind, t.cadence, t.colour_slot AS colourSlot, t.status, t.started_on AS startedOn, t.retired_on AS retiredOn,
                             m.provider, m.model_version AS modelVersion, m.effort
                           FROM traders t LEFT JOIN models m ON m.id = t.model_id WHERE t.started_on IS NOT NULL ORDER BY t.kind = 'benchmark', t.id`).all(),
      })),
    },
    '/api/traders/:id': {
      GET: open((req) => {
        const t = trader(db, Number(req.params?.id))
        return t ?? error(404, 'There is no Trader with that number.')
      }),
    },

    '/api/columnist': {
      GET: open((_req, url) => {
        const before = dateParam(url.searchParams.get('before')) ?? '9999-12-31'
        const kind = url.searchParams.get('kind')
        const posts = db.query(`SELECT kind, period_date AS date, headline, body FROM columnist_posts
                                WHERE period_date < ? AND (? IS NULL OR kind = ?) ORDER BY period_date DESC, kind = 'daily' LIMIT 20`)
          .all(before, kind === 'daily' || kind === 'weekly' ? kind : null, kind === 'daily' || kind === 'weekly' ? kind : null)
        return { posts }
      }),
    },
  }
}

/** @param {Database} db */
const galleryOpen = (db) => /** @type {{ g: number }} */ (db.query('SELECT gallery_enabled AS g FROM settings WHERE id = 1').get()).g === 1

/** @param {URL} url */
const track = (url) => /** @type {'daily' | 'weekly'} */ (url.searchParams.get('track') === 'weekly' ? 'weekly' : 'daily')

/** @param {string | null} s */
const dateParam = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)

/**
 * The last trading day with closing values.
 * @param {Database} db
 * @returns {string | null}
 */
export const latestDate = (db) => /** @type {{ d: string | null }} */ (db.query('SELECT MAX(trading_date) AS d FROM snapshots').get()).d

/**
 * Day one is the first open after the start; the start evening is day 0.
 * @param {Database} db
 * @param {string} date
 */
function dayNumber(db, date) {
  const { start_date: start } = /** @type {{ start_date: string | null }} */ (db.query('SELECT start_date FROM settings WHERE id = 1').get())
  if (!start || date <= start) return 0
  const dayOne = nextTradingDay(db, start)
  return dayOne ? tradingDaysBetween(db, dayOne, date).length : 0
}

/**
 * @param {Database} db
 * @param {Date} at
 */
function status(db, at) {
  const s = /** @type {{ experiment_state: string, start_date: string | null }} */ (db.query('SELECT experiment_state, start_date FROM settings WHERE id = 1').get())
  const today = marketDate(at)
  const open = openInstant(db, today)
  const close = closeInstant(db, today)
  const latest = latestDate(db)
  return {
    state: s.experiment_state,
    startDate: s.start_date,
    today,
    latestDate: latest,
    day: dayNumber(db, latest ?? today),
    market: open && close && at >= open && at < close ? 'open' : 'closed',
  }
}

/**
 * The biggest price moves on the menu at a close, against the close before.
 * @param {Database} db
 * @param {string} date
 */
function movers(db, date) {
  const before = previousTradingDay(db, date)
  if (!before) return []
  const rows = /** @type {Array<{ ticker: string, now: number, prev: number }>} */ (
    db.query(`SELECT i.ticker, b.close_micro AS now, p.close_micro AS prev FROM instruments i
              JOIN daily_bars b ON b.instrument_id = i.id AND b.date = ?
              JOIN daily_bars p ON p.instrument_id = i.id AND p.date = ?
              WHERE i.on_menu = 1 AND NOT EXISTS (SELECT 1 FROM corporate_actions c WHERE c.instrument_id = i.id AND c.kind = 'split' AND c.ex_date = ?)`).all(date, before, date)
  )
  const moves = rows.filter((r) => r.prev > 0).map((r) => ({ ticker: r.ticker, changePct: Math.round((r.now / r.prev - 1) * 10_000) / 100 + 0 }))
  moves.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || a.ticker.localeCompare(b.ticker))
  const top = moves.slice(0, 5)
  const spy = moves.find((m) => m.ticker === 'SPY')
  return spy && !top.includes(spy) ? [...top.slice(0, 4), spy] : top
}

/**
 * Every Trader's value at each close, for the value chart.
 * @param {Database} db
 * @param {'daily' | 'weekly'} trackName
 */
function series(db, trackName) {
  const dates = db.query('SELECT DISTINCT trading_date FROM snapshots ORDER BY trading_date').values().map(([d]) => String(d))
  const traders = /** @type {Array<{ id: number, name: string, kind: string, colourSlot: number | null }>} */ (
    db.query("SELECT id, name, kind, colour_slot AS colourSlot FROM traders WHERE started_on IS NOT NULL AND (kind = 'benchmark' OR cadence = ?) ORDER BY kind = 'benchmark', id").all(trackName)
  )
  const at = new Map(dates.map((d, i) => [d, i]))
  return {
    track: trackName,
    dates,
    series: traders.map((t) => {
      /** @type {(number | null)[]} */
      const values = dates.map(() => null)
      for (const [d, v] of db.query('SELECT trading_date, total_micro FROM snapshots WHERE trader_id = ?').values(t.id)) values[/** @type {number} */ (at.get(String(d)))] = Number(v)
      return { traderId: t.id, name: t.name, kind: t.kind, colourSlot: t.colourSlot, values }
    }),
  }
}

/**
 * The ends of past weeks and months with closing values, newest first, for the period picker.
 * @param {Database} db
 * @param {string | null} latest
 */
function periodEnds(db, latest) {
  if (!latest) return { latest: null, weeks: [], months: [] }
  const dates = db.query('SELECT DISTINCT trading_date FROM snapshots ORDER BY trading_date DESC').values().map(([d]) => String(d))
  /** @type {string[]} */
  const weeks = []
  /** @type {string[]} */
  const months = []
  for (const d of dates) {
    const week = firstTradingDayOfWeek(db, d)
    if (!weeks.some((w) => firstTradingDayOfWeek(db, w) === week)) weeks.push(d)
    if (!months.some((m) => m.slice(0, 7) === d.slice(0, 7))) months.push(d)
  }
  return { latest, weeks, months }
}

/**
 * One evening's decisions and how each order turned out: the Yesterday screen.
 * @param {Database} db
 * @param {string | null} date the decision date
 */
function day(db, date) {
  if (!date) return { date: null, fillDate: null, day: 0, prev: null, next: null, cards: [], counts: { orders: 0, trimmed: 0, rejected: 0 } }
  const decisionDates = 'SELECT d.trading_date FROM decisions d JOIN runs r ON r.id = d.run_id WHERE r.dry_run = 0'
  const prev = /** @type {{ d: string | null }} */ (db.query(`SELECT MAX(trading_date) AS d FROM (${decisionDates}) WHERE trading_date < ?`).get(date)).d
  const next = /** @type {{ d: string | null }} */ (db.query(`SELECT MIN(trading_date) AS d FROM (${decisionDates}) WHERE trading_date > ?`).get(date)).d
  const fillDate = nextTradingDay(db, date)
  const weekly = isLastTradingDayOfWeek(db, date)

  const traders = /** @type {Array<{ id: number, name: string, cadence: string, colourSlot: number | null }>} */ (
    db.query(`SELECT id, name, cadence, colour_slot AS colourSlot FROM traders
              WHERE kind = 'ai' AND started_on <= ?1 AND (retired_on IS NULL OR retired_on >= ?1) AND (cadence = 'daily' OR ?2) ORDER BY cadence, id`).all(date, weekly ? 1 : 0)
  )
  const decisionOf = db.prepare(`SELECT d.market_view AS marketView, d.no_trades_reason AS noTradesReason, d.run_id AS runId FROM decisions d JOIN runs r ON r.id = d.run_id
                                 WHERE d.trader_id = ? AND d.trading_date = ? AND r.dry_run = 0`)
  const failedRun = db.prepare(`SELECT r.error FROM runs r JOIN briefing_packs p ON p.id = r.pack_id
                                WHERE r.kind = 'trader' AND r.trader_id = ? AND p.trading_date = ? AND r.dry_run = 0 AND r.status = 'failed' ORDER BY r.id DESC LIMIT 1`)
  const ordersOf = db.prepare(`SELECT o.id, o.side, o.ticker, o.amount_micro AS amountMicro, o.sell_all AS sellAll, o.reason, o.verdict, o.verdict_note AS verdictNote,
                                 o.approved_amount_micro AS approvedAmountMicro, o.status, o.fill_note AS fillNote, o.fill_on AS fillOn,
                                 f.price_micro AS priceMicro, f.quantity_micro AS quantityMicro, f.amount_micro AS filledMicro, f.trading_date AS filledOn
                               FROM orders o LEFT JOIN fills f ON f.order_id = o.id WHERE o.run_id = ? ORDER BY o.side = 'buy', o.id`)
  const cashAfter = db.prepare('SELECT cash_micro FROM snapshots WHERE trader_id = ? AND trading_date = ?')

  const counts = { orders: 0, trimmed: 0, rejected: 0 }
  const cards = traders.map((t) => {
    const d = /** @type {{ marketView: string, noTradesReason: string | null, runId: number } | null} */ (decisionOf.get(t.id, date))
    const orders = d ? /** @type {any[]} */ (ordersOf.all(d.runId)).map((o) => ({ ...o, sellAll: o.sellAll === 1 })) : []
    counts.orders += orders.length
    counts.trimmed += orders.filter((o) => o.verdict === 'trimmed').length
    counts.rejected += orders.filter((o) => o.verdict === 'rejected').length
    const cash = fillDate ? /** @type {{ cash_micro: number } | null} */ (cashAfter.get(t.id, fillDate)) : null
    return {
      traderId: t.id,
      name: t.name,
      cadence: t.cadence,
      colourSlot: t.colourSlot,
      decided: d !== null,
      marketView: d?.marketView ?? null,
      noTradesReason: d?.noTradesReason ?? null,
      error: d ? null : /** @type {{ error: string | null } | null} */ (failedRun.get(t.id, date))?.error ?? null,
      orders,
      cashAfterMicro: cash?.cash_micro ?? null,
    }
  })
  return { date, fillDate, day: dayNumber(db, date), prev, next, cards, counts }
}

/**
 * The whole experiment, a week at a time, newest first: the History screen.
 * @param {Database} db
 * @param {'daily' | 'weekly'} trackName
 */
function history(db, trackName) {
  const { start_date: start } = /** @type {{ start_date: string | null }} */ (db.query('SELECT start_date FROM settings WHERE id = 1').get())
  const latest = latestDate(db)
  const tradesOn = db.prepare("SELECT COUNT(*) AS n FROM fills f JOIN traders t ON t.id = f.trader_id WHERE t.kind = 'ai' AND f.trading_date = ?")
  const trimsBetween = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE verdict = 'trimmed' AND status <> 'dry_run' AND decided_on BETWEEN ? AND ?")
  const missesBetween = db.prepare("SELECT COUNT(*) AS n FROM step_runs WHERE status = 'failed' AND trading_date BETWEEN ? AND ?")
  const count = (/** @type {any} */ stmt, /** @type {string[]} */ ...args) => /** @type {{ n: number }} */ (stmt.get(...args)).n

  if (!start || !latest) return { track: trackName, day: 0, totals: { tradingDays: 0, trades: 0, trims: 0, missedRuns: 0 }, weeks: [] }
  const days = tradingDaysBetween(db, start, latest)
  /** @type {Map<string, string[]>} */
  const byWeek = new Map()
  for (const d of days) {
    const w = /** @type {string} */ (firstTradingDayOfWeek(db, d))
    byWeek.set(w, [...(byWeek.get(w) ?? []), d])
  }
  const weeks = [...byWeek.values()].map((wd, i) => {
    const first = wd[0]
    const last = wd[wd.length - 1]
    const rows = standings(db, { track: trackName, kind: 'week', end: last })
    const best = rows.find((r) => r.kind === 'ai') ?? null
    const index = rows.find((r) => r.kind === 'benchmark') ?? null
    const post = /** @type {{ headline: string, body: string } | null} */ (db.query("SELECT headline, body FROM columnist_posts WHERE kind = 'weekly' AND period_date = ?").get(last))
    return {
      number: i + 1,
      start: first,
      end: last,
      complete: isLastTradingDayOfWeek(db, last) && last <= latest,
      post: post ? { headline: post.headline, summary: post.body.split(/\n\s*\n/)[0] } : null,
      best: best ? { traderId: best.traderId, name: best.name, returnPct: best.returnPct } : null,
      indexReturnPct: index?.returnPct ?? null,
      badges: badgesFor(db, 'week', last),
      days: wd.map((d) => ({ date: d, trades: count(tradesOn, d) })),
      trims: count(trimsBetween, first, last),
      misses: count(missesBetween, first, last),
    }
  })
  return {
    track: trackName,
    day: dayNumber(db, latest),
    totals: {
      tradingDays: dayNumber(db, latest),
      trades: /** @type {{ n: number }} */ (db.query("SELECT COUNT(*) AS n FROM fills f JOIN traders t ON t.id = f.trader_id WHERE t.kind = 'ai'").get()).n,
      trims: count(trimsBetween, start, latest),
      missedRuns: count(missesBetween, start, latest),
    },
    weeks: weeks.reverse(),
  }
}

/**
 * Everything about one Trader: the Trader detail and Compare screens.
 * @param {Database} db
 * @param {number} id
 */
function trader(db, id) {
  const t = /** @type {any} */ (db.query(`SELECT t.id, t.name, t.kind, t.cadence, t.colour_slot AS colourSlot, t.status, t.started_on AS startedOn, t.retired_on AS retiredOn,
                                            m.provider, m.model_version AS modelVersion, m.effort
                                          FROM traders t LEFT JOIN models m ON m.id = t.model_id WHERE t.id = ? AND t.started_on IS NOT NULL`).get(id))
  if (!t) return null
  const latest = latestDate(db)
  const positions = latest ? positionsAsOf(db, id, latest) : positionsOf(db, id)
  const value = latest ? valuePortfolio(cashOf(db, id, latest), positions, (instrumentId) => closeOn(db, instrumentId, latest)) : null
  const index = /** @type {{ id: number } | null} */ (db.query("SELECT id FROM traders WHERE kind = 'benchmark' ORDER BY id LIMIT 1").get())
  const valuesOf = (/** @type {number} */ traderId) => /** @type {Array<{ date: string, totalMicro: number }>} */ (db.query('SELECT trading_date AS date, total_micro AS totalMicro FROM snapshots WHERE trader_id = ? ORDER BY trading_date').all(traderId))
  const metricKeys = ['return_pct', 'vs_index_pct', 'max_drawdown_pct', 'cash_share_pct', 'positions', 'largest_position_pct', 'trades', 'turnover_pct', 'rule_breaks', 'avg_holding_days', 'losers_cut', 'added_to_loser']
  /** @type {Map<string, Record<string, number>>} */
  const metrics = new Map()
  for (const [date, key, v] of db.query(`SELECT trading_date, key, value FROM metrics WHERE trader_id = ? AND key IN (${metricKeys.map(() => '?').join(',')}) ORDER BY trading_date`).values(id, ...metricKeys)) {
    const row = metrics.get(String(date)) ?? {}
    row[String(key)] = Number(v)
    metrics.set(String(date), row)
  }
  return {
    trader: t,
    asOf: latest,
    cashMicro: value?.cash ?? null,
    totalMicro: value?.total ?? null,
    holdings: (value?.positions ?? []).map((p) => ({ ticker: p.ticker, quantityMicro: p.quantity_micro, costBasisMicro: p.cost_basis_micro, priceMicro: p.price_micro, valueMicro: p.value_micro })),
    values: valuesOf(id),
    indexValues: index && index.id !== id ? valuesOf(index.id) : [],
    trades: db.query(`SELECT f.trading_date AS date, f.side, i.ticker, f.price_micro AS priceMicro, f.quantity_micro AS quantityMicro, f.amount_micro AS amountMicro,
                        o.reason, o.verdict, o.verdict_note AS verdictNote, o.decided_on AS decidedOn
                      FROM fills f JOIN orders o ON o.id = f.order_id JOIN instruments i ON i.id = f.instrument_id
                      WHERE f.trader_id = ? ORDER BY f.trading_date DESC, f.id DESC LIMIT 200`).all(id),
    decisions: db.query(`SELECT d.trading_date AS date, d.market_view AS marketView, d.journal, d.no_trades_reason AS noTradesReason
                         FROM decisions d JOIN runs r ON r.id = d.run_id WHERE d.trader_id = ? AND r.dry_run = 0 ORDER BY d.trading_date DESC LIMIT 30`).all(id),
    metrics: [...metrics].map(([date, m]) => ({ date, ...m })),
  }
}
