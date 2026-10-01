// The scheduler: once a minute it works out which steps are due on the New
// York market calendar and runs them in order. Each step is keyed by name and
// trading date in step_runs, so nothing runs twice; if the server was down,
// missed steps run in order when it is back (a late Opening Bell still fills
// at that day's official open). A paused experiment skips its due steps.
import { closeInstant, isLastTradingDayOfWeek, marketDate, openInstant, tradingDaysBetween } from '../core/calendar.js'
import { checkBooks } from '../core/books.js'
import { closeOfDay } from '../core/metrics.js'
import { awardBadgesAtClose } from '../core/standings.js'
import { ringOpeningBell } from '../core/openingBell.js'
import { budget, mayRun } from '../agents/budget.js'
import { writeColumn } from '../agents/columnist.js'
import { runTrader } from '../agents/trader.js'
import { saveBars } from '../market/store.js'
import { INDEX_TICKER } from '../core/traders.js'
import { runFloorRunner } from './floorRunner.js'

/** @typedef {import('bun:sqlite').Database} Database */

const MINUTE = 60_000
/** A failed step tries again on its own this many times in all, this far apart. */
export const AUTO_ATTEMPTS = 3
const RETRY_AFTER = 15 * MINUTE
/** A step still 'running' after this long was cut off (the server stopped mid-step) and runs again. */
const STALE_AFTER = 30 * MINUTE

/**
 * What a step needs from the outside world. Tests pass fakes.
 * @typedef {object} StepContext
 * @property {Database} db
 * @property {() => Date} now
 * @property {import('../market/alpaca.js').Alpaca} alpaca
 * @property {import('../market/store.js').StockMenu} [menu] the default stock menu (tests use a small one)
 * @property {(model: import('../agents/models.js').ModelRow) => import('ai').LanguageModel} [languageModel]
 * @property {typeof import('ai').generateText} [generate]
 * @property {(ms: number) => Promise<void>} [sleep]
 */

/** @param {Database} db @param {string} date */
export const openingBellDue = (db, date) => {
  const open = openInstant(db, date)
  return open ? new Date(open.getTime() + 30 * MINUTE) : null
}

/** @param {Database} db @param {string} date */
export const floorRunnerDue = (db, date) => {
  const close = closeInstant(db, date)
  return close ? new Date(close.getTime() + 45 * MINUTE) : null
}

/**
 * @typedef {object} Step
 * @property {string} name
 * @property {(db: Database, date: string, startDate: string) => boolean} [runsOn] default: every trading day
 * @property {(db: Database, date: string) => Date | null} due
 * @property {string[]} after steps that must be done (succeeded or skipped) first, same date
 * @property {(ctx: StepContext, date: string) => Promise<string | null>} run returns a note, or null; throws on failure
 */

/**
 * Run every active AI Trader of a cadence on that day's pack. A Trader that
 * fails holds this time (its runs record why); a Trader that already decided
 * that day is not asked again.
 * @param {StepContext} ctx
 * @param {string} date
 * @param {'daily' | 'weekly'} cadence
 */
async function runTraders(ctx, date, cadence) {
  const { db } = ctx
  if (!mayRun(budget(db, ctx.now()), `${cadence} trader`)) return `Skipped: the month's projected spend has reached the budget ceiling, so the ${cadence} Traders pause.`
  const pack = /** @type {{ id: number } | null} */ (db.query('SELECT id FROM briefing_packs WHERE kind = ? AND trading_date = ?').get(cadence, date))
  if (!pack) throw new Error(`There is no ${cadence} briefing pack for ${date}.`)
  const traders = /** @type {Array<{ id: number, name: string }>} */ (
    db.query(`SELECT t.id, t.name FROM traders t WHERE t.kind = 'ai' AND t.status = 'active' AND t.cadence = ? AND t.started_on <= ?
              AND NOT EXISTS (SELECT 1 FROM decisions d JOIN runs r ON r.id = d.run_id WHERE d.trader_id = t.id AND d.trading_date = ? AND r.dry_run = 0)
              ORDER BY t.id`).all(cadence, date, date)
  )
  const held = []
  for (const t of traders) {
    const r = await runTrader({ db, traderId: t.id, packId: pack.id, now: ctx.now, languageModel: ctx.languageModel, generate: ctx.generate, sleep: ctx.sleep })
    if (!r.ok) held.push(`${t.name} (${r.error})`)
  }
  return held.length ? `These Traders couldn't decide and hold this time: ${held.join('; ')}.` : null
}

/**
 * @param {StepContext} ctx
 * @param {'daily' | 'weekly'} kind
 * @param {string} date
 */
async function column(ctx, kind, date) {
  if (!mayRun(budget(ctx.db, ctx.now()), kind === 'daily' ? 'daily recap' : 'weekly report')) return "Skipped: the month's projected spend has reached the budget ceiling, so the daily recap pauses."
  const r = await writeColumn({ db: ctx.db, kind, date, now: ctx.now, languageModel: ctx.languageModel, generate: ctx.generate, sleep: ctx.sleep })
  if (!r.ok) throw new Error(`The Market Columnist couldn't write the ${kind === 'daily' ? 'daily recap' : 'weekly report'}: ${r.error}`)
  return null
}

const lastOfWeek = (/** @type {Database} */ db, /** @type {string} */ date) => isLastTradingDayOfWeek(db, date)

/** The steps of a trading day, in the order they run. */
export const STEPS = /** @type {Step[]} */ ([
  {
    name: 'opening-bell',
    // Orders decided on the start evening fill at the next open, so there is nothing to fill on the start date itself.
    runsOn: (db, date, startDate) => date > startDate,
    due: openingBellDue,
    after: [],
    run: async ({ db, alpaca, now }, date) => {
      // Today's official opening prices for what will trade. The rest of today's bar fills in
      // later: the Floor Runner overwrites it with the full day after the close.
      const tickers = db.query(`SELECT DISTINCT ticker FROM orders WHERE status = 'queued' AND fill_on = ? AND instrument_id IS NOT NULL
                                UNION SELECT ? WHERE EXISTS (SELECT 1 FROM traders WHERE kind = 'benchmark' AND status = 'active' AND started_on <= ?)`)
        .values(date, INDEX_TICKER, date).map(([t]) => String(t))
      if (tickers.length) saveBars(db, await alpaca.dailyBars(tickers, date, date), 'alpaca')
      const r = ringOpeningBell(db, { date, now: now() })
      return `Filled ${r.filled} orders${r.scaled ? `, scaled down ${r.scaled}` : ''}${r.cancelled ? `, cancelled ${r.cancelled}` : ''}.`
    },
  },
  {
    name: 'floor-runner',
    due: floorRunnerDue,
    after: [],
    run: async ({ db, alpaca, menu, now }, date) => {
      const r = await runFloorRunner({ db, alpaca, date, menu, now })
      if (r.skipped) return r.skipped
      closeOfDay(db, date)
      awardBadgesAtClose(db, date)
      const problems = checkBooks(db)
      return problems.length ? `The books don't balance: ${problems.join(' ')}` : null
    },
  },
  { name: 'daily-traders', due: floorRunnerDue, after: ['floor-runner'], run: (ctx, date) => runTraders(ctx, date, 'daily') },
  { name: 'weekly-traders', runsOn: lastOfWeek, due: floorRunnerDue, after: ['daily-traders'], run: (ctx, date) => runTraders(ctx, date, 'weekly') },
  { name: 'daily-recap', due: floorRunnerDue, after: ['daily-traders', 'weekly-traders'], run: (ctx, date) => column(ctx, 'daily', date) },
  { name: 'weekly-report', runsOn: lastOfWeek, due: floorRunnerDue, after: ['weekly-traders'], run: (ctx, date) => column(ctx, 'weekly', date) },
])

/**
 * @typedef {object} StepRun
 * @property {string} step
 * @property {string} trading_date
 * @property {'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'} status
 * @property {number} attempt
 * @property {string | null} started_at
 * @property {string | null} finished_at
 * @property {string | null} error
 */

/**
 * The steps that should run now, oldest first.
 * @param {Database} db
 * @param {Date} now
 * @returns {Array<{ step: Step, date: string }>}
 */
export function dueSteps(db, now) {
  const { start_date: startDate } = /** @type {{ start_date: string | null }} */ (db.query('SELECT start_date FROM settings WHERE id = 1').get())
  if (!startDate) return []
  const runOf = db.prepare('SELECT step, trading_date, status, attempt, started_at, finished_at, error FROM step_runs WHERE step = ? AND trading_date = ?')
  const due = []
  for (const date of tradingDaysBetween(db, startDate, marketDate(now))) {
    /** @type {Map<string, StepRun | null>} */
    const runs = new Map(STEPS.map((s) => [s.name, /** @type {StepRun | null} */ (runOf.get(s.name, date))]))
    const applies = (/** @type {Step} */ s) => !s.runsOn || s.runsOn(db, date, startDate)
    const done = (/** @type {string} */ name) => {
      const s = /** @type {Step} */ (STEPS.find((x) => x.name === name))
      const r = runs.get(name)
      return !applies(s) || r?.status === 'succeeded' || r?.status === 'skipped'
    }
    for (const step of STEPS) {
      if (!applies(step) || done(step.name)) continue
      const when = step.due(db, date)
      if (!when || when > now || !step.after.every(done)) continue
      const r = runs.get(step.name)
      if (r?.status === 'running' && now.getTime() - Date.parse(/** @type {string} */ (r.started_at)) < STALE_AFTER) continue
      if (r?.status === 'failed' && (r.attempt >= AUTO_ATTEMPTS || now.getTime() - Date.parse(/** @type {string} */ (r.finished_at)) < RETRY_AFTER)) continue
      due.push({ step, date })
    }
  }
  return due
}

/**
 * One scheduler pass: run (or, when paused, skip) every due step in order.
 * @param {StepContext} ctx
 * @returns {Promise<Array<{ step: string, date: string, status: string, note: string | null }>>}
 */
export async function tick(ctx) {
  const { db } = ctx
  const { experiment_state: state } = /** @type {{ experiment_state: string }} */ (db.query('SELECT experiment_state FROM settings WHERE id = 1').get())
  if (state !== 'running' && state !== 'paused') return []
  const done = []
  // Re-check after every step: one step finishing makes the next one due.
  for (let next = dueSteps(db, ctx.now())[0]; next; next = dueSteps(db, ctx.now())[0]) {
    const { step, date } = next
    const at = ctx.now().toISOString()
    if (state === 'paused') {
      record(db, step.name, date, { status: 'skipped', error: 'The experiment was paused.', at, attempt: 0 })
      done.push({ step: step.name, date, status: 'skipped', note: 'The experiment was paused.' })
      continue
    }
    const attempt = (/** @type {{ attempt: number } | null} */ (db.query('SELECT attempt FROM step_runs WHERE step = ? AND trading_date = ?').get(step.name, date))?.attempt ?? 0) + 1
    db.run(`INSERT INTO step_runs (step, trading_date, status, attempt, started_at) VALUES (?, ?, 'running', ?, ?)
            ON CONFLICT (step, trading_date) DO UPDATE SET status = 'running', attempt = excluded.attempt, started_at = excluded.started_at, finished_at = NULL, error = NULL`,
      [step.name, date, attempt, at])
    try {
      const note = await step.run(ctx, date)
      const skipped = note?.startsWith('Skipped') || note?.startsWith('The market is closed')
      record(db, step.name, date, { status: skipped ? 'skipped' : 'succeeded', error: note, at: ctx.now().toISOString(), attempt })
      done.push({ step: step.name, date, status: skipped ? 'skipped' : 'succeeded', note })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      record(db, step.name, date, { status: 'failed', error: message, at: ctx.now().toISOString(), attempt })
      done.push({ step: step.name, date, status: 'failed', note: message })
    }
  }
  return done
}

/**
 * @param {Database} db
 * @param {string} step
 * @param {string} date
 * @param {{ status: string, error: string | null, at: string, attempt: number }} r
 */
function record(db, step, date, { status, error, at, attempt }) {
  db.run(`INSERT INTO step_runs (step, trading_date, status, attempt, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (step, trading_date) DO UPDATE SET status = excluded.status, finished_at = excluded.finished_at, error = excluded.error`,
    [step, date, status, attempt, at, at, error])
}

/**
 * Let a failed step run again at the next pass, with a fresh set of automatic tries.
 * @param {Database} db
 * @param {string} step
 * @param {string} date
 */
export function rerunStep(db, step, date) {
  const r = db.run("UPDATE step_runs SET status = 'pending', attempt = 0, error = NULL WHERE step = ? AND trading_date = ? AND status IN ('failed', 'skipped')", [step, date])
  if (!r.changes) throw new Error(`There is no failed or skipped ${step} step on ${date} to run again.`)
}

/**
 * Run the scheduler once a minute inside the server process.
 * @param {StepContext} ctx
 * @returns {() => void} stops it
 */
export function startScheduler(ctx) {
  let busy = false
  const pass = async () => {
    if (busy) return
    busy = true
    try {
      for (const r of await tick(ctx)) console.log(`[scheduler] ${r.date} ${r.step}: ${r.status}${r.note ? ` (${r.note})` : ''}`)
    } catch (e) {
      console.error('[scheduler]', e)
    } finally {
      busy = false
    }
  }
  pass()
  const timer = setInterval(pass, MINUTE)
  return () => clearInterval(timer)
}
