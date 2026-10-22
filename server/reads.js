// Public reads: everything the Gallery screens show. Open to anyone while the
// Trade Master has the Gallery switched on, and always to the Trade Master;
// otherwise every route here refuses (fail closed). Money stays in
// micro-dollars; the client converts for display.
import { closeInstant, firstTradingDayOfWeek, isLastTradingDayOfWeek, isTradingDay, marketDate, nextTradingDay, openInstant, previousTradingDay, tradingDaysBetween } from '../core/calendar.js'
import { closeOn, positionsOf, valuePortfolio, cashOf } from '../core/portfolio.js'
import { positionsAsOf } from '../core/books.js'
import { badgesFor, periodStart, standings } from '../core/standings.js'
import { platformChanges } from '../core/changes.js'
import { tracks } from '../core/tracks.js'
import { dayNumber, PAPER_PHASE_DAYS } from '../jobs/experiment.js'

export { dayNumber }
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
        const all = publicTracks(db)
        return {
          status: status(db, now()),
          movers: latest ? movers(db, latest) : [],
          tracks: all,
          standings: Object.fromEntries(all.map((k) => [k.slug, latest ? standings(db, { track: k.slug, kind: 'all', end: latest }) : []])),
          recap: db.query("SELECT kind, period_date AS date, headline, body FROM columnist_posts WHERE kind = 'daily' ORDER BY period_date DESC LIMIT 1").get() ?? null,
          hero: hero(db, latest),
        }
      }),
    },

    '/api/series': { GET: open((_req, url) => series(db, track(db, url))) },

    '/api/tracks': { GET: open(() => ({ tracks: publicTracks(db) })) },
    '/api/compare/tracks': {
      GET: open((req, url) => {
        const known = publicTracks(db).map((k) => k.slug)
        const a = url.searchParams.get('a') ?? ''
        const b = url.searchParams.get('b') ?? ''
        if (!known.includes(a) || !known.includes(b)) return error(404, 'Pick two tracks from the list.')
        // What the models cost is for the Trade Master, like the Costs screen.
        return compareTracks(db, a, b, { costs: isTradeMaster(db, req) })
      }),
    },

    '/api/standings': {
      GET: open((_req, url) => {
        const latest = latestDate(db)
        const kindParam = url.searchParams.get('kind')
        const kind = /** @type {import('../core/standings.js').PeriodKind} */ (['day', 'week', 'month', 'all'].includes(kindParam ?? '') ? kindParam : 'week')
        const end = dateParam(url.searchParams.get('end')) ?? latest
        const ends = periodEnds(db, latest)
        const slug = track(db, url)
        if (!end) return { track: slug, kind, end: null, start: null, rows: [], badges: [], periods: ends }
        return {
          track: slug,
          kind,
          end,
          start: periodStart(db, kind, end),
          rows: standings(db, { track: slug, kind, end }),
          badges: kind === 'week' || kind === 'month' ? badgesFor(db, kind, end) : [],
          periods: ends,
        }
      }),
    },

    '/api/days/latest': {
      GET: open((req) => {
        const date = /** @type {{ d: string | null }} */ (db.query('SELECT MAX(d.trading_date) AS d FROM decisions d JOIN runs r ON r.id = d.run_id WHERE r.dry_run = 0').get()).d
        return day(db, date, isTradeMaster(db, req))
      }),
    },
    '/api/days/:date': {
      GET: open((req) => {
        const date = dateParam(req.params?.date ?? null)
        if (!date) return error(400, 'Pick a date written as YYYY-MM-DD.')
        if (!isTradingDay(db, date)) return error(404, `${date} was not a trading day, so nobody decided anything.`)
        const latest = /** @type {{ d: string | null }} */ (db.query('SELECT MAX(d.trading_date) AS d FROM decisions d JOIN runs r ON r.id = d.run_id WHERE r.dry_run = 0').get()).d
        if (!latest || date > latest) return error(404, `The Traders have not decided anything for ${date} yet.`)
        return day(db, date, isTradeMaster(db, req))
      }),
    },

    '/api/history': { GET: open((_req, url) => history(db, track(db, url))) },

    '/api/traders': {
      GET: open(() => ({
        traders: db.query(`SELECT t.id, t.name, t.kind, t.cadence, t.colour_slot AS colourSlot, t.status, t.started_on AS startedOn, t.retired_on AS retiredOn,
                             m.provider, m.model_version AS modelVersion, m.effort, k.slug AS track, k.title AS trackTitle
                           FROM traders t LEFT JOIN models m ON m.id = t.model_id LEFT JOIN tracks k ON k.id = t.track_id
                           WHERE t.started_on IS NOT NULL ORDER BY t.kind = 'benchmark', t.track_id, t.id`).all(),
        tracks: publicTracks(db),
      })),
    },
    '/api/traders/:id': {
      GET: open((req) => {
        const t = trader(db, Number(req.params?.id))
        return t ?? error(404, 'There is no Trader with that number.')
      }),
    },

    // The change log for the About page: open even while the Gallery is closed,
    // like the page itself. It holds only what changed for the Traders, and when.
    '/api/changes': {
      GET: () => json({
        startDate: /** @type {{ start_date: string | null }} */ (db.query('SELECT start_date FROM settings WHERE id = 1').get()).start_date,
        changes: platformChanges(db),
      }),
    },

    '/api/columnist': {
      GET: open((_req, url) => {
        // The cursor is the last post seen, `YYYY-MM-DD:kind`, in the feed's own
        // order (newest date first, a date's weekly post before its daily one).
        // A bare date means everything on that date has been seen.
        const [, before = '9999-12-31', seen = 'daily'] = /^(\d{4}-\d{2}-\d{2})(?::(daily|weekly))?$/.exec(url.searchParams.get('before') ?? '') ?? []
        const kindParam = url.searchParams.get('kind')
        const kind = kindParam === 'daily' || kindParam === 'weekly' ? kindParam : null
        /** @type {Array<{ kind: string, date: string, headline: string, body: string }>} */
        const posts = /** @type {any} */ (db.query(`SELECT kind, period_date AS date, headline, body FROM columnist_posts
                                WHERE (period_date < ?1 OR (period_date = ?1 AND (kind = 'daily') > (?2 = 'daily'))) AND (?3 IS NULL OR kind = ?3)
                                ORDER BY period_date DESC, kind = 'daily' LIMIT 20`).all(before, seen, kind))
        const last = posts.at(-1)
        return { posts, nextCursor: posts.length === 20 && last ? `${last.date}:${last.kind}` : null }
      }),
    },
  }
}

/** @param {Database} db */
const galleryOpen = (db) => /** @type {{ g: number }} */ (db.query('SELECT gallery_enabled AS g FROM settings WHERE id = 1').get()).g === 1

/**
 * The Track asked for by its slug; the daily one when none (or an unknown one) is asked for.
 * @param {Database} db
 * @param {URL} url
 */
const track = (db, url) => {
  const slug = url.searchParams.get('track') ?? 'daily'
  return db.query('SELECT 1 FROM tracks WHERE slug = ?').get(slug) ? slug : 'daily'
}

/**
 * The Tracks that have started (or all of them before the start), with what
 * their Traders get, for track pickers and labels.
 * @param {Database} db
 */
export function publicTracks(db) {
  const started = /** @type {{ s: string | null }} */ (db.query('SELECT start_date AS s FROM settings WHERE id = 1').get()).s
  const count = db.prepare("SELECT COUNT(*) AS n FROM traders WHERE track_id = ? AND kind = 'ai' AND status <> 'retired'")
  return tracks(db).filter((k) => !started || k.started_on).map((k) => ({
    slug: k.slug,
    title: k.title,
    cadence: k.cadence,
    briefingPack: k.briefing_pack,
    webSearch: k.web_search,
    searchesPerRun: k.searches_per_run,
    startedOn: k.started_on,
    traders: /** @type {{ n: number }} */ (count.get(k.id)).n,
  }))
}

/** @param {string | null} s */
const dateParam = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)

/**
 * The last trading day with closing values.
 * @param {Database} db
 * @returns {string | null}
 */
export const latestDate = (db) => /** @type {{ d: string | null }} */ (db.query('SELECT MAX(trading_date) AS d FROM snapshots').get()).d

/**
 * How many trading days the experiment is set to run: up to its end date once it
 * has started (null when it runs on with no end, after a resume past the end),
 * or the planned paper phase before the start.
 * @param {Database} db
 * @returns {number | null}
 */
export function plannedDays(db) {
  const s = /** @type {{ start_date: string | null, end_date: string | null }} */ (db.query('SELECT start_date, end_date FROM settings WHERE id = 1').get())
  if (!s.start_date) return PAPER_PHASE_DAYS
  return s.end_date ? dayNumber(db, s.end_date) : null
}

/**
 * @param {Database} db
 * @param {Date} at
 */
function status(db, at) {
  const s = /** @type {{ experiment_state: string, start_date: string | null }} */ (db.query('SELECT experiment_state, start_date FROM settings WHERE id = 1').get())
  const today = marketDate(at)
  const latest = latestDate(db)
  return {
    state: s.experiment_state,
    startDate: s.start_date,
    today,
    latestDate: latest,
    day: dayNumber(db, latest ?? today),
    ...marketStatus(db, at),
  }
}

/** How long before the open the market counts as "opening soon". */
const SOON_MS = 60 * 60_000

/**
 * The New York market at an instant: open (until the close), opening soon (the
 * hour before the open), closed, or a holiday (a weekday with no trading), with
 * the moment that changes. changesAt is null past the end of the stored calendar.
 * @param {Database} db
 * @param {Date} at
 * @returns {{ market: 'open' | 'soon' | 'closed' | 'holiday', changesAt: string | null }}
 */
export function marketStatus(db, at) {
  const today = marketDate(at)
  const open = openInstant(db, today)
  const close = closeInstant(db, today)
  if (open && close && at >= open && at < close) return { market: 'open', changesAt: close.toISOString() }
  if (open && at < open) return { market: open.getTime() - at.getTime() <= SOON_MS ? 'soon' : 'closed', changesAt: open.toISOString() }
  const next = nextTradingDay(db, today)
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  return { market: !open && weekday >= 1 && weekday <= 5 ? 'holiday' : 'closed', changesAt: next ? openInstant(db, next)?.toISOString() ?? null : null }
}


/**
 * What the landing hero shows: the line-up size, the starting cash, trades so
 * far, and each daily Trader's latest value (The Index last) for the jury box.
 * @param {Database} db
 * @param {string | null} latest
 */
function hero(db, latest) {
  const { starting_cash_micro: settingCash } = /** @type {{ starting_cash_micro: number }} */ (db.query('SELECT starting_cash_micro FROM settings WHERE id = 1').get())
  // What the active AI Traders actually started with; before the start, the setting.
  const starts = db.query(`SELECT DISTINCT l.amount_micro FROM cash_ledger l JOIN traders t ON t.id = l.trader_id
                           WHERE l.kind = 'start' AND t.kind = 'ai' AND t.status <> 'retired' ORDER BY l.amount_micro`).values().map(([a]) => Number(a))
  const startingCashMicro = starts[0] ?? settingCash
  const valueOn = db.prepare('SELECT total_micro FROM snapshots WHERE trader_id = ? AND trading_date = ?')
  const daily = /** @type {Array<{ id: number, name: string, kind: string, colourSlot: number | null }>} */ (
    db.query(`SELECT id, name, kind, colour_slot AS colourSlot FROM traders
              WHERE status <> 'retired' AND (kind = 'benchmark' OR track_id = (SELECT id FROM tracks WHERE slug = 'daily')) ORDER BY kind = 'benchmark', id`).all()
  )
  return {
    traders: /** @type {{ n: number }} */ (db.query("SELECT COUNT(*) AS n FROM traders WHERE kind = 'ai' AND status <> 'retired'").get()).n,
    startingCashMicro,
    cashVaries: starts.length > 1,
    totalDays: plannedDays(db),
    trades: /** @type {{ n: number }} */ (db.query('SELECT COUNT(*) AS n FROM fills').get()).n,
    daily: daily.map((t) => ({
      ...t,
      totalMicro: (latest ? /** @type {{ total_micro: number } | null} */ (valueOn.get(t.id, latest))?.total_micro : null) ?? startingCashMicro,
    })),
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
 * @param {string} trackName the Track's slug
 */
function series(db, trackName) {
  const dates = db.query('SELECT DISTINCT trading_date FROM snapshots ORDER BY trading_date').values().map(([d]) => String(d))
  const traders = /** @type {Array<{ id: number, name: string, kind: string, colourSlot: number | null }>} */ (
    db.query("SELECT id, name, kind, colour_slot AS colourSlot FROM traders WHERE started_on IS NOT NULL AND (kind = 'benchmark' OR track_id = (SELECT id FROM tracks WHERE slug = ?)) ORDER BY kind = 'benchmark', id").all(trackName)
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

// What visitors see when a Trader's model call failed. The raw error comes from
// the provider and is for the Trade Master's troubleshooting only.
export const FAILED_RUN_NOTE = "The model didn't give a usable answer, so this Trader held."

/**
 * One evening's decisions and how each order turned out: the Yesterday screen.
 * @param {Database} db
 * @param {string | null} date the decision date
 * @param {boolean} tradeMaster the Trade Master sees a failed run's raw error
 */
function day(db, date, tradeMaster) {
  if (!date) return { date: null, fillDate: null, day: 0, prev: null, next: null, cards: [], counts: { orders: 0, trimmed: 0, rejected: 0 } }
  const decisionDates = 'SELECT d.trading_date FROM decisions d JOIN runs r ON r.id = d.run_id WHERE r.dry_run = 0'
  const prev = /** @type {{ d: string | null }} */ (db.query(`SELECT MAX(trading_date) AS d FROM (${decisionDates}) WHERE trading_date < ?`).get(date)).d
  const next = /** @type {{ d: string | null }} */ (db.query(`SELECT MIN(trading_date) AS d FROM (${decisionDates}) WHERE trading_date > ?`).get(date)).d
  const fillDate = nextTradingDay(db, date)
  const weekly = isLastTradingDayOfWeek(db, date)

  const traders = /** @type {Array<{ id: number, name: string, cadence: string, colourSlot: number | null, track: string | null, trackTitle: string | null }>} */ (
    db.query(`SELECT t.id, t.name, t.cadence, t.colour_slot AS colourSlot, k.slug AS track, k.title AS trackTitle FROM traders t LEFT JOIN tracks k ON k.id = t.track_id
              WHERE t.kind = 'ai' AND t.started_on <= ?1 AND (t.retired_on IS NULL OR t.retired_on >= ?1) AND (t.cadence = 'daily' OR ?2) ORDER BY t.cadence, t.track_id, t.id`).all(date, weekly ? 1 : 0)
  )
  const decisionOf = db.prepare(`SELECT d.market_view AS marketView, d.no_trades_reason AS noTradesReason, d.run_id AS runId FROM decisions d JOIN runs r ON r.id = d.run_id
                                 WHERE d.trader_id = ? AND d.trading_date = ? AND r.dry_run = 0`)
  const failedRun = db.prepare(`SELECT r.error FROM runs r JOIN briefing_packs p ON p.id = r.pack_id
                                WHERE r.kind = 'trader' AND r.trader_id = ? AND p.trading_date = ? AND r.dry_run = 0 AND r.status = 'failed' ORDER BY r.id DESC LIMIT 1`)
  const ordersOf = db.prepare(`SELECT o.id, o.side, o.ticker, (SELECT name FROM instruments WHERE ticker = o.ticker LIMIT 1) AS name, o.amount_micro AS amountMicro, o.sell_all AS sellAll, o.reason, o.verdict, o.verdict_note AS verdictNote,
                                 o.approved_amount_micro AS approvedAmountMicro, o.status, o.fill_note AS fillNote, o.fill_on AS fillOn,
                                 f.price_micro AS priceMicro, f.quantity_micro AS quantityMicro, f.amount_micro AS filledMicro, f.trading_date AS filledOn
                               FROM orders o LEFT JOIN fills f ON f.order_id = o.id WHERE o.run_id = ? ORDER BY o.side = 'buy', o.id`)
  const cashAfter = db.prepare('SELECT cash_micro FROM snapshots WHERE trader_id = ? AND trading_date = ?')

  const failure = (/** @type {{ error: string | null } | null} */ run) => (!run ? null : tradeMaster ? run.error ?? FAILED_RUN_NOTE : FAILED_RUN_NOTE)

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
      track: t.track,
      trackTitle: t.trackTitle,
      colourSlot: t.colourSlot,
      decided: d !== null,
      marketView: d?.marketView ?? null,
      noTradesReason: d?.noTradesReason ?? null,
      error: d ? null : failure(/** @type {{ error: string | null } | null} */ (failedRun.get(t.id, date))),
      orders,
      cashAfterMicro: cash?.cash_micro ?? null,
    }
  })
  return { date, fillDate, day: dayNumber(db, date), prev, next, cards, counts }
}

/**
 * The whole experiment, a week at a time, newest first: the History screen.
 * @param {Database} db
 * @param {string} trackName the Track's slug
 */
function history(db, trackName) {
  const { start_date: start } = /** @type {{ start_date: string | null }} */ (db.query('SELECT start_date FROM settings WHERE id = 1').get())
  const latest = latestDate(db)
  // Trades and trims are the chosen track's AI Traders' own; missed runs are the whole experiment's.
  const tradesOn = db.prepare(`SELECT COUNT(*) AS n FROM fills f JOIN traders t ON t.id = f.trader_id WHERE t.kind = 'ai' AND t.track_id = (SELECT id FROM tracks WHERE slug = ?) AND f.trading_date = ?`)
  const trimsBetween = db.prepare(`SELECT COUNT(*) AS n FROM orders o JOIN traders t ON t.id = o.trader_id
                                   WHERE t.kind = 'ai' AND t.track_id = (SELECT id FROM tracks WHERE slug = ?) AND o.verdict = 'trimmed' AND o.status <> 'dry_run' AND o.decided_on BETWEEN ? AND ?`)
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
      days: wd.map((d) => ({ date: d, trades: count(tradesOn, trackName, d) })),
      trims: count(trimsBetween, trackName, first, last),
      misses: count(missesBetween, first, last),
    }
  })
  return {
    track: trackName,
    day: dayNumber(db, latest),
    totals: {
      tradingDays: dayNumber(db, latest),
      trades: /** @type {{ n: number }} */ (db.query("SELECT COUNT(*) AS n FROM fills f JOIN traders t ON t.id = f.trader_id WHERE t.kind = 'ai' AND t.track_id = (SELECT id FROM tracks WHERE slug = ?)").get(trackName)).n,
      trims: count(trimsBetween, trackName, start, latest),
      missedRuns: count(missesBetween, start, latest),
    },
    weeks: weeks.reverse(),
  }
}

// A Trader's page lists its latest trades; totalTrades counts them all.
export const TRADES_SHOWN = 200

/**
 * Everything about one Trader: the Trader detail and Compare screens.
 * @param {Database} db
 * @param {number} id
 */
function trader(db, id) {
  const t = /** @type {any} */ (db.query(`SELECT t.id, t.name, t.kind, t.cadence, t.colour_slot AS colourSlot, t.status, t.started_on AS startedOn, t.retired_on AS retiredOn,
                                            m.provider, m.model_version AS modelVersion, m.effort, k.slug AS track, k.title AS trackTitle, k.web_search AS webSearch, k.briefing_pack AS briefingPack
                                          FROM traders t LEFT JOIN models m ON m.id = t.model_id LEFT JOIN tracks k ON k.id = t.track_id WHERE t.id = ? AND t.started_on IS NOT NULL`).get(id))
  if (!t) return null
  const latest = latestDate(db)
  const positions = latest ? positionsAsOf(db, id, latest) : positionsOf(db, id)
  const value = latest ? valuePortfolio(cashOf(db, id, latest), positions, (instrumentId) => closeOn(db, instrumentId, latest)) : null
  const index = /** @type {{ id: number } | null} */ (db.query("SELECT id FROM traders WHERE kind = 'benchmark' ORDER BY id LIMIT 1").get())
  const nameOf = /** @type {import('bun:sqlite').Statement<{ name: string }, [string]>} */ (db.prepare('SELECT name FROM instruments WHERE ticker = ? LIMIT 1'))
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
    holdings: (value?.positions ?? []).map((p) => ({ ticker: p.ticker, name: nameOf.get(p.ticker)?.name ?? null, quantityMicro: p.quantity_micro, costBasisMicro: p.cost_basis_micro, priceMicro: p.price_micro, valueMicro: p.value_micro })),
    values: valuesOf(id),
    indexValues: index && index.id !== id ? valuesOf(index.id) : [],
    trades: db.query(`SELECT f.trading_date AS date, f.side, i.ticker, i.name, f.price_micro AS priceMicro, f.quantity_micro AS quantityMicro, f.amount_micro AS amountMicro,
                        o.reason, o.verdict, o.verdict_note AS verdictNote, o.decided_on AS decidedOn
                      FROM fills f JOIN orders o ON o.id = f.order_id JOIN instruments i ON i.id = f.instrument_id
                      WHERE f.trader_id = ? ORDER BY f.trading_date DESC, f.id DESC LIMIT ${TRADES_SHOWN}`).all(id),
    totalTrades: /** @type {{ n: number }} */ (db.query('SELECT COUNT(*) AS n FROM fills WHERE trader_id = ?').get(id)).n,
    decisions: db.query(`SELECT d.trading_date AS date, d.market_view AS marketView, d.journal, d.no_trades_reason AS noTradesReason
                         FROM decisions d JOIN runs r ON r.id = d.run_id WHERE d.trader_id = ? AND r.dry_run = 0 ORDER BY d.trading_date DESC LIMIT 30`).all(id),
    metrics: [...metrics].map(([date, m]) => ({ date, ...m })),
  }
}


/**
 * Two Tracks side by side from the day both had started: each Track's line is
 * the average of its Traders' values, and every line (The Index too) is set
 * to 100 at that day's close, so neither Track gets credit for the weeks the
 * other hadn't started. The Compare screen's "Track vs Track".
 * @param {Database} db
 * @param {string} a a Track's slug
 * @param {string} b another (or the same) Track's slug
 * @param {{ costs?: boolean }} [options] costs: include what each Track's model calls cost
 */
export function compareTracks(db, a, b, { costs = false } = {}) {
  const lastValue = (/** @type {(number | null)[]} */ xs) => [...xs].reverse().find((v) => v !== null) ?? null
  const pick = (/** @type {string} */ slug) => /** @type {import('../core/tracks.js').Track} */ (tracks(db).find((k) => k.slug === slug))
  const both = [pick(a), pick(b)]
  const latest = latestDate(db)
  const starts = both.map((k) => k.started_on)
  const base = starts.every(Boolean) ? /** @type {string} */ (starts.reduce((x, y) => ((y ?? '') > (x ?? '') ? y : x))) : null
  const empty = { base, latest, dates: [], lines: [], index: null, rows: both.map((k) => ({ slug: k.slug, title: k.title, webSearch: k.web_search, briefingPack: k.briefing_pack, traders: 0 })) }
  if (!base || !latest || base > latest) return empty
  const dates = db.query('SELECT DISTINCT trading_date FROM snapshots WHERE trading_date >= ? ORDER BY trading_date').values(base).map(([d]) => String(d))
  if (!dates.length) return empty
  const valuesOf = db.prepare('SELECT trading_date, total_micro, cash_micro FROM snapshots WHERE trader_id = ? AND trading_date >= ? ORDER BY trading_date')
  /** @param {number} id @returns {Map<string, { total: number, cash: number }>} */
  const snapshotsOf = (id) => new Map(/** @type {Array<{ trading_date: string, total_micro: number, cash_micro: number }>} */ (valuesOf.all(id, base)).map((r) => [r.trading_date, { total: r.total_micro, cash: r.cash_micro }]))
  /** Each date's value as a share of the first one, times 100. @param {Map<string, { total: number }>} m */
  const rebased = (m) => {
    const first = dates.map((d) => m.get(d)?.total).find((v) => v !== undefined)
    return dates.map((d) => (first && m.has(d) ? (/** @type {{ total: number }} */ (m.get(d)).total / first) * 100 : null))
  }
  const round2 = (/** @type {number} */ n) => Math.round(n * 100) / 100 + 0
  const index = /** @type {{ id: number } | null} */ (db.query("SELECT id FROM traders WHERE kind = 'benchmark' ORDER BY id LIMIT 1").get())
  const indexLine = index ? rebased(snapshotsOf(index.id)) : null
  const indexReturn = indexLine ? lastValue(indexLine) : null
  const tradesOf = db.prepare('SELECT COUNT(*) AS n FROM fills WHERE trader_id = ? AND trading_date > ?')
  const breaksOf = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE trader_id = ? AND verdict IN ('trimmed', 'rejected') AND status <> 'dry_run' AND decided_on >= ?")
  const costOf = db.prepare(`SELECT COALESCE(SUM(r.cost_micro), 0) AS cost, COALESCE(SUM(r.searches), 0) AS searches FROM runs r JOIN briefing_packs p ON p.id = r.pack_id
                             WHERE r.trader_id = ? AND r.dry_run = 0 AND p.trading_date >= ?`)
  const count = (/** @type {any} */ stmt, /** @type {number} */ id) => /** @type {{ n: number }} */ (stmt.get(id, base)).n

  const per = both.map((k) => {
    const traders = /** @type {Array<{ id: number, name: string, colourSlot: number | null }>} */ (
      db.query("SELECT id, name, colour_slot AS colourSlot FROM traders WHERE kind = 'ai' AND track_id = ? AND started_on IS NOT NULL ORDER BY id").all(k.id))
    const figures = traders.map((t) => {
      const m = snapshotsOf(t.id)
      const line = rebased(m)
      const last = [...dates].reverse().find((d) => m.has(d))
      const snap = last ? m.get(last) : undefined
      const spend = /** @type {{ cost: number, searches: number }} */ (costOf.get(t.id, base))
      return {
        line,
        returnPct: lastValue(line),
        cashSharePct: snap && snap.total ? (snap.cash / snap.total) * 100 : null,
        trades: count(tradesOf, t.id),
        ruleBreaks: count(breaksOf, t.id),
        costMicro: spend.cost,
        searches: spend.searches,
        trader: { traderId: t.id, name: t.name, colourSlot: t.colourSlot },
      }
    })
    const mean = (/** @type {(number | null)[]} */ xs) => {
      const ok = /** @type {number[]} */ (xs.filter((x) => x !== null))
      return ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : null
    }
    const line = dates.map((_, i) => mean(figures.map((f) => f.line[i])))
    const ranked = figures.filter((f) => f.returnPct !== null).sort((x, y) => /** @type {number} */ (y.returnPct) - /** @type {number} */ (x.returnPct))
    const asReturn = (/** @type {number | null | undefined} */ v) => (v === null || v === undefined ? null : round2(v - 100))
    const avg = mean(figures.map((f) => f.returnPct))
    const cost = figures.reduce((s, f) => s + f.costMicro, 0)
    return {
      line,
      row: {
        slug: k.slug,
        title: k.title,
        webSearch: k.web_search,
        briefingPack: k.briefing_pack,
        traders: figures.length,
        returnPct: asReturn(avg),
        vsIndexPct: avg === null || indexReturn === null ? null : round2(avg - indexReturn),
        best: ranked[0] ? { ...ranked[0].trader, returnPct: asReturn(ranked[0].returnPct) } : null,
        worst: ranked.length > 1 ? { ...ranked[ranked.length - 1].trader, returnPct: asReturn(ranked[ranked.length - 1].returnPct) } : null,
        cashSharePct: (() => { const c = mean(figures.map((f) => f.cashSharePct)); return c === null ? null : round2(c) })(),
        trades: figures.reduce((s, f) => s + f.trades, 0),
        ruleBreaks: figures.reduce((s, f) => s + f.ruleBreaks, 0),
        searches: figures.reduce((s, f) => s + f.searches, 0),
        ...(costs ? { costMicro: cost, costPerTraderMicro: figures.length ? Math.round(cost / figures.length) : 0 } : {}),
      },
    }
  })
  return {
    base,
    latest,
    dates,
    lines: per.map((p, i) => ({ slug: both[i].slug, title: both[i].title, values: p.line.map((v) => (v === null ? null : round2(v))) })),
    index: indexLine ? { values: indexLine.map((v) => (v === null ? null : round2(v))), returnPct: indexReturn === null ? null : round2(indexReturn - 100) } : null,
    rows: per.map((p) => p.row),
  }
}
