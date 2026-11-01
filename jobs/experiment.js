// The experiment's life: set up the line-up, rehearse with a dry run, start,
// pause and resume. The Trade Master drives these from the admin screens.
import { isLastTradingDayOfWeek, isTradingDay, marketDate, nextTradingDay, tradingDaysBetween } from '../core/calendar.js'
import { DEFAULT_RULES } from '../core/portfolio.js'
import { createIndex, createTrader } from '../core/traders.js'
import { checkNewTrack, describeTrack, modelLabel, slugFor, trackBySlug } from '../core/tracks.js'
import { ensureColumnistModels, ensureModel, LINE_UP } from '../agents/models.js'
import { runTrader } from '../agents/trader.js'
import { saveCalendar } from '../market/store.js'
import { CALENDAR_END, runFloorRunner } from './floorRunner.js'
import { floorRunnerDue, openingBellDue } from './schedule.js'

/** @typedef {import('bun:sqlite').Database} Database */

/** The paper phase runs three months: about 63 trading days after the start evening. */
export const PAPER_PHASE_DAYS = 63

/**
 * The last trading day of the paper phase: day 63 after the start evening.
 * @param {Database} db
 * @param {string} startDate
 * @returns {string | null} null when the calendar doesn't reach that far
 */
export function lastDayFor(db, startDate) {
  const row = /** @type {{ date: string } | null} */ (
    db.query("SELECT date FROM trading_days WHERE calendar = 'XNYS' AND date > ? ORDER BY date LIMIT 1 OFFSET ?").get(startDate, PAPER_PHASE_DAYS - 1)
  )
  return row?.date ?? null
}

/**
 * The experiment's day number: day one is the first open after the start; the start evening is day 0.
 * @param {Database} db
 * @param {string} date
 */
export function dayNumber(db, date) {
  const { start_date: start } = /** @type {{ start_date: string | null }} */ (db.query('SELECT start_date FROM settings WHERE id = 1').get())
  if (!start || date <= start) return 0
  const dayOne = nextTradingDay(db, start)
  return dayOne ? tradingDaysBetween(db, dayOne, date).length : 0
}

/** "Fri 13 Nov". @param {string} date */
const shortDay = (date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`)).replace(',', '')

/**
 * Move the experiment's last trading day. Only a trading day after today, so
 * tonight's orders still have an open to fill at. Checks first and throws a
 * plain sentence; `apply` then changes it and lists the change for the About
 * page, from the next evening the Traders decide (they are told the end date).
 * @param {Database} db
 * @param {unknown} value
 * @param {Date} now
 * @returns {{ date: string, apply: () => void }}
 */
export function checkEndDate(db, value, now) {
  const s = settings(db)
  if (s.experiment_state === 'setup') throw new Error('The last trading day can change once the experiment has started.')
  if (s.experiment_state === 'ended') throw new Error('The experiment has ended.')
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
  if (!date) throw new Error('Pick a date for the last trading day.')
  if (date <= marketDate(now)) throw new Error('Pick a trading day after today.')
  const last = /** @type {{ d: string | null }} */ (db.query("SELECT MAX(date) AS d FROM trading_days WHERE calendar = 'XNYS'").get()).d
  if (!last || date > last) throw new Error(`The market calendar only runs to ${last ? shortDay(last) : 'today'}. Pick an earlier trading day.`)
  if (!isTradingDay(db, date)) throw new Error(`Markets are closed on ${shortDay(date)}. Pick a trading day.`)
  return {
    date,
    apply: () => {
      if (date === s.end_date) return
      // The old date and when it moved: each Trader's next run says so.
      db.run('UPDATE settings SET end_date = ?, end_date_previous = end_date, end_date_moved_at = ?, updated_at = ? WHERE id = 1', [date, now.toISOString(), now.toISOString()])
      db.run('INSERT INTO platform_changes (effective_on, area, summary, pr_number, created_at) VALUES (?, ?, ?, NULL, ?)',
        [firstDecisionDate(db, now) ?? date, 'Rules', `Last trading day moved to ${shortDay(date)} (day ${dayNumber(db, date)}).`, now.toISOString()])
    },
  }
}

/**
 * @typedef {object} Settings
 * @property {'setup' | 'running' | 'paused' | 'ended'} experiment_state
 * @property {string | null} start_date
 * @property {string | null} end_date the paper phase's last trading day; the experiment pauses itself after its evening
 * @property {number} starting_cash_micro
 * @property {number} budget_ceiling_micro
 * @property {number} gallery_enabled
 * @property {string | null} default_rules JSON: the guardrails a new Trader starts with
 */

/** @param {Database} db @returns {Settings} */
export const settings = (db) => /** @type {Settings} */ (db.query('SELECT * FROM settings WHERE id = 1').get())

/**
 * The guardrails a new Trader starts with: the Trade Master's last change, else the built-in defaults.
 * @param {Database} db
 * @returns {import('../core/portfolio.js').Rules}
 */
export const defaultRules = (db) => ({ ...DEFAULT_RULES, ...JSON.parse(settings(db).default_rules ?? '{}') })

/**
 * Create the PRD's line-up the first time: four models, each with a daily and
 * a weekly Trader, plus the Columnist's models. Traders hold their starting
 * cash from now, but join the experiment only when it starts.
 * @param {Database} db
 * @param {Date} now
 * @returns {number} Traders created
 */
export function seedLineUp(db, now) {
  ensureColumnistModels(db, now)
  if (db.query("SELECT 1 FROM traders WHERE kind = 'ai'").get()) return 0
  const { starting_cash_micro } = settings(db)
  const rules = defaultRules(db)
  let created = 0
  db.transaction(() => {
    for (const t of LINE_UP.traders) {
      const modelId = ensureModel(db, t, now)
      for (const cadence of /** @type {const} */ (['daily', 'weekly'])) {
        const trackId = trackBySlug(db, cadence)?.id ?? null
        createTrader(db, { name: `${t.name} ${cadence}`, modelId, cadence, trackId, colourSlot: t.colourSlot, startedOn: null, asOf: marketDate(now), cashMicro: starting_cash_micro, rules, now })
        created++
      }
    }
  })()
  return created
}

/**
 * Change the starting cash while setting up; it is fixed once the experiment starts.
 * @param {Database} db
 * @param {number} cashMicro
 * @param {Date} now
 */
export function setStartingCash(db, cashMicro, now) {
  if (settings(db).experiment_state !== 'setup') throw new Error('Starting cash can only change before the experiment starts.')
  db.transaction(() => {
    db.run('UPDATE settings SET starting_cash_micro = ?, updated_at = ? WHERE id = 1', [cashMicro, now.toISOString()])
    db.run("UPDATE cash_ledger SET amount_micro = ? WHERE kind = 'start' AND trader_id IN (SELECT id FROM traders WHERE started_on IS NULL)", [cashMicro])
  })()
}

/**
 * The first evening a new Trader on a cadence decides: the first decision
 * evening for a daily one, the last trading day of that week (or a later one)
 * for a weekly one. null when the calendar doesn't reach that far.
 * @param {Database} db
 * @param {'daily' | 'weekly'} cadence
 * @param {Date} now
 */
export function firstEveningFor(db, cadence, now) {
  let date = firstDecisionDate(db, now)
  if (cadence === 'daily') return date
  while (date && !isLastTradingDayOfWeek(db, date)) date = nextTradingDay(db, date)
  return date
}

/**
 * Add a Track: one new Trader for each model in the line-up (the models of
 * the active AI Traders), with fresh starting cash, joining on the Track's
 * first evening. Its conditions are fixed from now on. Listed in the change
 * log from that evening.
 * @param {Database} db
 * @param {Record<string, unknown>} input title, cadence, briefingPack, webSearch, searchesPerRun
 * @param {Date} now
 * @returns {{ id: number, slug: string, startedOn: string | null, traders: number }}
 */
export function createTrack(db, input, now) {
  const t = checkNewTrack(input)
  const s = settings(db)
  if (s.experiment_state === 'ended') throw new Error('The experiment has ended.')
  const slug = slugFor(t.cadence, t.title)
  if (trackBySlug(db, slug)) throw new Error(`There is already a track called "${t.title}". Give this one another title.`)
  const models = /** @type {Array<{ model_id: number, colour_slot: number | null, name: string }>} */ (
    db.query(`SELECT model_id, MIN(colour_slot) AS colour_slot, MIN(name) AS name FROM traders
              WHERE kind = 'ai' AND status = 'active' GROUP BY model_id ORDER BY MIN(colour_slot), MIN(id)`).all()
  )
  if (!models.length) throw new Error('There are no active Traders to take the models from.')
  const startedOn = s.experiment_state === 'setup' ? null : firstEveningFor(db, t.cadence, now)
  if (s.experiment_state !== 'setup' && !startedOn) throw new Error('The market calendar has no next trading day loaded.')
  const words = slug.split('-').join(' ')
  const names = models.map((m) => `${modelLabel(m.name)} ${words}`)
  const taken = names.find((n) => db.query('SELECT 1 FROM traders WHERE name = ?').get(n))
  if (taken) throw new Error(`There is already a Trader called "${taken}". Give the track another title.`)
  const rules = defaultRules(db)
  const row = { cadence: t.cadence, briefing_pack: t.briefingPack, web_search: t.webSearch, searches_per_run: t.searchesPerRun }
  return db.transaction(() => {
    const { id } = /** @type {{ id: number }} */ (
      db.query(`INSERT INTO tracks (slug, title, cadence, briefing_pack, web_search, searches_per_run, started_on, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(slug, t.title, t.cadence, t.briefingPack, t.webSearch, t.searchesPerRun, startedOn, now.toISOString())
    )
    models.forEach((m, i) => createTrader(db, {
      name: names[i], modelId: m.model_id, cadence: t.cadence, trackId: id, colourSlot: m.colour_slot,
      startedOn, asOf: startedOn ?? marketDate(now), cashMicro: s.starting_cash_micro, rules, now,
    }))
    if (startedOn) {
      db.run('INSERT INTO platform_changes (effective_on, area, summary, pr_number, created_at) VALUES (?, ?, ?, NULL, ?)',
        [startedOn, 'Tracks', `New track "${t.title}" starts with one Trader per model and fresh starting cash. It ${describeTrack(row)}. The other Traders are unchanged.`, now.toISOString()])
    }
    return { id, slug, startedOn, traders: models.length }
  })()
}

/**
 * Rename a Track. The title is for readers only: the Traders never see it.
 * @param {Database} db
 * @param {number} id
 * @param {string} title already checked
 */
export function renameTrack(db, id, title) {
  const r = db.run('UPDATE tracks SET title = ? WHERE id = ?', [title, id])
  if (!r.changes) throw new Error('There is no track with that id.')
}

/**
 * The first evening the Traders can decide: today if its Floor Runner step is still to come, else the next trading day.
 * @param {Database} db
 * @param {Date} now
 */
export function firstDecisionDate(db, now) {
  const today = marketDate(now)
  if (isTradingDay(db, today) && /** @type {Date} */ (floorRunnerDue(db, today)) > now) return today
  return nextTradingDay(db, today)
}

/**
 * Start the experiment: every set-up Trader joins on the first decision
 * evening, and The Index buys SPY at the open after it (day one).
 * @param {Database} db
 * @param {{ now: Date, date?: string }} options
 * @returns {{ startDate: string, dayOne: string }}
 */
export function startExperiment(db, { now, date }) {
  const s = settings(db)
  if (s.experiment_state !== 'setup') throw new Error('The experiment has already started.')
  const startDate = date ?? firstDecisionDate(db, now)
  if (!startDate || !isTradingDay(db, startDate)) throw new Error('The market calendar is not loaded yet. Run a dry run first so the Floor Runner can fetch it.')
  const dayOne = /** @type {string} */ (nextTradingDay(db, startDate))
  seedLineUp(db, now)
  db.transaction(() => {
    db.run("UPDATE traders SET started_on = ? WHERE kind = 'ai' AND started_on IS NULL AND status = 'active'", [startDate])
    db.run('UPDATE tracks SET started_on = ? WHERE started_on IS NULL', [startDate])
    createIndex(db, { startedOn: dayOne, cashMicro: s.starting_cash_micro, now })
    db.run("UPDATE settings SET experiment_state = 'running', start_date = ?, end_date = ?, updated_at = ? WHERE id = 1", [startDate, lastDayFor(db, startDate), now.toISOString()])
  })()
  return { startDate, dayOne }
}

/**
 * Pause: due steps are skipped until resumed, queued orders are kept.
 * @param {Database} db
 * @param {Date} now
 */
export function pauseExperiment(db, now) {
  if (settings(db).experiment_state !== 'running') throw new Error('Only a running experiment can be paused.')
  db.run("UPDATE settings SET experiment_state = 'paused', updated_at = ? WHERE id = 1", [now.toISOString()])
}

/**
 * Resume: orders that were waiting for a skipped open fill at the next one.
 * Resuming after the paper phase's last day carries on with no end date.
 * @param {Database} db
 * @param {Date} now
 */
export function resumeExperiment(db, now) {
  const s = settings(db)
  if (s.experiment_state !== 'paused') throw new Error('Only a paused experiment can be resumed.')
  if (s.end_date && marketDate(now) >= s.end_date) db.run('UPDATE settings SET end_date = NULL WHERE id = 1')
  const today = marketDate(now)
  const due = openingBellDue(db, today)
  const nextOpen = isTradingDay(db, today) && due && due > now ? today : nextTradingDay(db, today)
  db.transaction(() => {
    db.run("UPDATE orders SET fill_on = ? WHERE status = 'queued' AND fill_on < ?", [nextOpen, nextOpen])
    db.run("UPDATE settings SET experiment_state = 'running', updated_at = ? WHERE id = 1", [now.toISOString()])
  })()
}

/**
 * The latest trading day whose Floor Runner time has passed, looking back up to two weeks.
 * @param {Database} db
 * @param {Date} now
 */
function latestClosedDay(db, now) {
  for (let d = new Date(`${marketDate(now)}T12:00:00Z`), i = 0; i < 14; i++, d.setUTCDate(d.getUTCDate() - 1)) {
    const date = d.toISOString().slice(0, 10)
    const due = floorRunnerDue(db, date)
    if (due && due <= now) return date
  }
  return null
}

/**
 * The rehearsal: every active Trader decides on the latest briefing pack
 * (built first if there is none) with the dry-run flag. Nothing touches
 * orders, positions or standings; the cost is recorded.
 * @param {object} o
 * @param {Database} o.db
 * @param {() => Date} o.now
 * @param {import('../market/alpaca.js').Alpaca} o.alpaca
 * @param {import('../market/store.js').StockMenu} [o.menu]
 * @param {(model: import('../agents/models.js').ModelRow) => import('ai').LanguageModel} [o.languageModel]
 * @param {typeof import('ai').generateText} [o.generate]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 */
export async function dryRun({ db, now, alpaca, menu, languageModel, generate, sleep }) {
  seedLineUp(db, now())
  /** @param {string} kind */
  const latestPack = (kind) => /** @type {{ id: number, trading_date: string } | null} */ (db.query('SELECT id, trading_date FROM briefing_packs WHERE kind = ? ORDER BY trading_date DESC LIMIT 1').get(kind))
  if (!latestPack('daily')) {
    if (!db.query('SELECT 1 FROM trading_days LIMIT 1').get()) {
      const from = new Date(now().getTime() - 150 * 86_400_000).toISOString().slice(0, 10)
      saveCalendar(db, await alpaca.calendar(from, CALENDAR_END))
    }
    const date = latestClosedDay(db, now())
    if (date) await runFloorRunner({ db, alpaca, date, menu, now })
  }
  const daily = latestPack('daily')
  if (!daily) throw new Error("The Floor Runner couldn't build a briefing pack for the dry run.")
  const weekly = latestPack('weekly') ?? daily

  const traders = /** @type {Array<{ id: number, name: string, cadence: string }>} */ (
    db.query("SELECT id, name, cadence FROM traders WHERE kind = 'ai' AND status = 'active' ORDER BY id").all()
  )
  const results = []
  for (const t of traders) {
    const packId = t.cadence === 'weekly' ? weekly.id : daily.id
    const r = await runTrader({ db, traderId: t.id, packId, dryRun: true, now, languageModel, generate, sleep })
    // What the Trade Master reads: the Trader's own words and each order with the Compliance Desk's verdict.
    const decision = /** @type {{ market_view: string, no_trades_reason: string | null } | null} */ (
      r.ok ? db.query('SELECT market_view, no_trades_reason FROM decisions WHERE run_id = ?').get(r.runId) : null)
    const orders = db.query(`SELECT side, ticker, amount_micro AS amountMicro, sell_all AS sellAll, reason, verdict, verdict_note AS note, approved_amount_micro AS approvedAmountMicro
                             FROM orders WHERE run_id = ? ORDER BY id`).all(r.runId)
    results.push({ traderId: t.id, trader: t.name, ok: r.ok, error: r.error ?? null, costMicro: r.costMicro, verdicts: r.verdicts,
      marketView: decision?.market_view ?? null, noTradesReason: decision?.no_trades_reason ?? null, orders })
  }
  return { packDate: daily.trading_date, results }
}
