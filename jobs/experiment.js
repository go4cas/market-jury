// The experiment's life: set up the line-up, rehearse with a dry run, start,
// pause and resume. The Trade Master drives these from the admin screens.
import { isTradingDay, marketDate, nextTradingDay } from '../core/calendar.js'
import { DEFAULT_RULES } from '../core/portfolio.js'
import { createIndex, createTrader } from '../core/traders.js'
import { ensureColumnistModels, ensureModel, LINE_UP } from '../agents/models.js'
import { runTrader } from '../agents/trader.js'
import { saveCalendar } from '../market/store.js'
import { CALENDAR_END, runFloorRunner } from './floorRunner.js'
import { floorRunnerDue, openingBellDue } from './schedule.js'

/** @typedef {import('bun:sqlite').Database} Database */

/**
 * @typedef {object} Settings
 * @property {'setup' | 'running' | 'paused' | 'ended'} experiment_state
 * @property {string | null} start_date
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
        createTrader(db, { name: `${t.name} ${cadence}`, modelId, cadence, colourSlot: t.colourSlot, startedOn: null, asOf: marketDate(now), cashMicro: starting_cash_micro, rules, now })
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
    createIndex(db, { startedOn: dayOne, cashMicro: s.starting_cash_micro, now })
    db.run("UPDATE settings SET experiment_state = 'running', start_date = ?, updated_at = ? WHERE id = 1", [startDate, now.toISOString()])
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
 * @param {Database} db
 * @param {Date} now
 */
export function resumeExperiment(db, now) {
  if (settings(db).experiment_state !== 'paused') throw new Error('Only a paused experiment can be resumed.')
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
