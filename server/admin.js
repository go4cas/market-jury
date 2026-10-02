// Trade Master routes: start, pause and rehearse the experiment, watch the
// scheduler, change settings and the line-up, and see costs. Every route
// here, reads included, needs the Trade Master's session.
import { marketDate, nextTradingDay, openInstant, previousTradingDay } from '../core/calendar.js'
import { fromMicro, toMicro } from '../core/money.js'
import { rulesFor } from '../core/portfolio.js'
import { createTrader, retireTrader } from '../core/traders.js'
import { budget } from '../agents/budget.js'
import { costOf, ensureModel, KEY_NAMES } from '../agents/models.js'
import { dryRun, firstDecisionDate, pauseExperiment, resumeExperiment, seedLineUp, setStartingCash, settings, startExperiment } from '../jobs/experiment.js'
import { openingBellDue, rerunStep, STEPS } from '../jobs/schedule.js'
import { isTradeMaster } from './auth.js'
import { error, json, readJson } from './http.js'
import { dayNumber, latestDate } from './reads.js'

/** @typedef {import('bun:sqlite').Database} Database */
/** @typedef {import('../jobs/schedule.js').StepContext} StepContext */

/** PRD usage assumptions per run, for projecting a model's monthly cost. */
const TOKENS_PER_RUN = { input: 20_000, cached: 0, output: 4_000 }
const RUNS_PER_MONTH = { daily: 21, weekly: 4.35 }

/**
 * @param {StepContext} ctx the scheduler's context (database, clock, market data, models)
 */
export function adminRoutes(ctx) {
  const { db } = ctx
  /** @type {{ running: boolean, startedAt: string | null, finishedAt: string | null, result: unknown, error: string | null }} */
  const rehearsal = { running: false, startedAt: null, finishedAt: null, result: null, error: null }

  /**
   * Wrap a handler: Trade Master only, and a thrown Error becomes a plain 400.
   * @param {(req: Request & { params?: Record<string, string> }) => Response | Promise<Response>} handler
   */
  const guarded = (handler) => async (/** @type {Request & { params?: Record<string, string> }} */ req) => {
    if (!isTradeMaster(db, req)) return error(401, 'Log in as the Trade Master to do this.')
    try {
      return await handler(req)
    } catch (e) {
      return error(400, e instanceof Error ? e.message : String(e))
    }
  }
  /** @param {Request} req */
  const body = async (req) => {
    const b = await readJson(req)
    if (!b) throw new Error('Send the details as JSON.')
    return b
  }

  return {
    '/api/admin/status': {
      GET: guarded(() => {
        const s = settings(db)
        const recent = db.query('SELECT step, trading_date, status, attempt, finished_at, error FROM step_runs ORDER BY trading_date DESC, id DESC LIMIT 12').all()
        const failed = db.query("SELECT step, trading_date, error FROM step_runs WHERE status = 'failed' ORDER BY trading_date DESC").all()
        return json({
          state: s.experiment_state,
          startDate: s.start_date,
          firstDecisionDate: s.experiment_state === 'setup' ? firstDecisionDate(db, ctx.now()) : null,
          budget: budgetJson(budget(db, ctx.now())),
          failedSteps: failed,
          recentSteps: recent,
          missingKeys: Object.values(KEY_NAMES).filter((k) => !process.env[k]),
          day: dayNumber(db, latestDate(db) ?? marketDate(ctx.now())),
          nextOpen: nextOpen(db, ctx.now()),
        })
      }),
    },

    '/api/admin/experiment/start': {
      POST: guarded(async (req) => {
        const b = await readJson(req)
        const date = typeof b?.date === 'string' ? b.date : undefined
        return json(startExperiment(db, { now: ctx.now(), date }))
      }),
    },
    '/api/admin/experiment/pause': { POST: guarded(() => (pauseExperiment(db, ctx.now()), json({ state: 'paused' }))) },
    '/api/admin/experiment/resume': { POST: guarded(() => (resumeExperiment(db, ctx.now()), json({ state: 'running' }))) },

    '/api/admin/steps': {
      GET: guarded((req) => {
        const before = new URL(req.url).searchParams.get('before') ?? '9999-12-31'
        const rows = db.query('SELECT step, trading_date, status, attempt, started_at, finished_at, error FROM step_runs WHERE trading_date < ? ORDER BY trading_date DESC, id DESC LIMIT 60').all(before)
        return json({ steps: rows, order: STEPS.map((s) => s.name) })
      }),
    },
    '/api/admin/steps/rerun': {
      POST: guarded(async (req) => {
        const b = await body(req)
        rerunStep(db, String(b.step ?? ''), String(b.date ?? ''))
        return json({ ok: true })
      }),
    },

    '/api/admin/dry-run': {
      GET: guarded(() => json(rehearsal)),
      POST: guarded(() => {
        if (rehearsal.running) return error(409, 'A dry run is already going. It takes a few minutes.')
        Object.assign(rehearsal, { running: true, startedAt: ctx.now().toISOString(), finishedAt: null, result: null, error: null })
        dryRun(ctx)
          .then((result) => Object.assign(rehearsal, { result }))
          .catch((e) => Object.assign(rehearsal, { error: e instanceof Error ? e.message : String(e) }))
          .finally(() => Object.assign(rehearsal, { running: false, finishedAt: ctx.now().toISOString() }))
        return json(rehearsal, 202)
      }),
    },

    '/api/admin/packs': {
      GET: guarded((req) => {
        const url = new URL(req.url)
        const kind = url.searchParams.get('kind') === 'weekly' ? 'weekly' : 'daily'
        const dates = db.query('SELECT trading_date FROM briefing_packs WHERE kind = ? ORDER BY trading_date DESC').values(kind).map(([d]) => String(d))
        const date = url.searchParams.get('date') ?? dates[0] ?? null
        const pack = /** @type {{ content: string, created_at: string } | null} */ (date ? db.query('SELECT content, created_at FROM briefing_packs WHERE kind = ? AND trading_date = ?').get(kind, date) : null)
        if (date && !pack) return error(404, `There is no ${kind} briefing pack for ${date}.`)
        return json({ kind, date, dates, createdAt: pack?.created_at ?? null, pack: pack ? JSON.parse(pack.content) : null })
      }),
    },

    '/api/admin/costs': {
      GET: guarded(() => {
        const b = budget(db, ctx.now())
        const byTrader = db.query(`SELECT COALESCE(t.name, 'Market Columnist') AS name, m.provider, m.model_version, COUNT(*) AS calls,
                                     SUM(r.tokens_in) AS tokens_in, SUM(r.tokens_out) AS tokens_out, SUM(r.cost_micro) AS cost_micro
                                   FROM runs r JOIN models m ON m.id = r.model_id LEFT JOIN traders t ON t.id = r.trader_id
                                   WHERE substr(r.started_at, 1, 7) = ? GROUP BY r.trader_id, m.id ORDER BY cost_micro DESC`).all(b.month)
        const byProvider = db.query(`SELECT m.provider, SUM(r.cost_micro) AS cost_micro FROM runs r JOIN models m ON m.id = r.model_id
                                     WHERE substr(r.started_at, 1, 7) = ? GROUP BY m.provider ORDER BY cost_micro DESC`).all(b.month)
        return json({ budget: budgetJson(b), byTrader, byProvider })
      }),
    },

    '/api/admin/settings': {
      GET: guarded(() => {
        const s = settings(db)
        const anyTrader = /** @type {{ id: number } | null} */ (db.query("SELECT id FROM traders WHERE kind = 'ai' AND status = 'active' ORDER BY id LIMIT 1").get())
        const rules = anyTrader ? rulesFor(db, anyTrader.id, marketDate(ctx.now())) : null
        return json({
          state: s.experiment_state,
          galleryEnabled: s.gallery_enabled === 1,
          budgetCeilingUsd: fromMicro(s.budget_ceiling_micro),
          startingCashUsd: fromMicro(s.starting_cash_micro),
          positionCapPct: rules?.position_cap_pct ?? null,
          perTradeCostUsd: rules ? fromMicro(rules.per_trade_cost_micro) : null,
          menu: db.query('SELECT ticker, name, asset_class, on_menu FROM instruments ORDER BY ticker').all(),
        })
      }),
      PATCH: guarded(async (req) => {
        const b = await body(req)
        const now = ctx.now()
        const at = now.toISOString()
        if ('galleryEnabled' in b) db.run('UPDATE settings SET gallery_enabled = ?, updated_at = ? WHERE id = 1', [b.galleryEnabled === true ? 1 : 0, at])
        if ('budgetCeilingUsd' in b) {
          const usd = positive(b.budgetCeilingUsd, 'The budget ceiling')
          db.run('UPDATE settings SET budget_ceiling_micro = ?, updated_at = ? WHERE id = 1', [toMicro(usd), at])
        }
        if ('startingCashUsd' in b) setStartingCash(db, toMicro(positive(b.startingCashUsd, 'Starting cash')), now)
        /** @type {Record<string, number>} */
        const guardrails = {}
        if ('positionCapPct' in b) {
          const pct = positive(b.positionCapPct, 'The position cap')
          if (pct > 100) throw new Error('The position cap is a percentage of the portfolio, so at most 100.')
          guardrails.position_cap_pct = pct
        }
        if ('perTradeCostUsd' in b) {
          const usd = Number(b.perTradeCostUsd)
          if (!(usd >= 0)) throw new Error('The per-trade cost must be zero or more dollars.')
          guardrails.per_trade_cost_micro = toMicro(usd)
        }
        if (Object.keys(guardrails).length) setGuardrails(db, guardrails, now)
        return json({ ok: true })
      }),
    },

    '/api/admin/menu': {
      PATCH: guarded(async (req) => {
        const b = await body(req)
        const r = db.run('UPDATE instruments SET on_menu = ?, removed_on = ? WHERE ticker = ?', [b.onMenu === true ? 1 : 0, b.onMenu === true ? null : marketDate(ctx.now()), String(b.ticker ?? '').toUpperCase()])
        if (!r.changes) throw new Error(`${b.ticker} is not a ticker in the stock list.`)
        return json({ ok: true })
      }),
    },

    '/api/admin/traders': {
      GET: guarded(() => {
        if (settings(db).experiment_state === 'setup') seedLineUp(db, ctx.now())
        return json({
          traders: db.query(`SELECT t.id, t.name, t.kind, t.cadence, t.colour_slot, t.status, t.started_on, t.retired_on, m.provider, m.model_version, m.effort,
                               (SELECT COUNT(*) FROM positions p WHERE p.trader_id = t.id AND p.quantity_micro > 0) AS positions
                             FROM traders t LEFT JOIN models m ON m.id = t.model_id ORDER BY t.kind = 'benchmark', t.id`).all(),
        })
      }),
      POST: guarded(async (req) => {
        const t = newTraderFrom(await body(req))
        const now = ctx.now()
        const s = settings(db)
        if (s.experiment_state === 'ended') throw new Error('The experiment has ended.')
        const used = db.query("SELECT colour_slot FROM traders WHERE kind = 'ai' AND status <> 'retired'").values().map(([c]) => Number(c))
        const slot = Array.from({ length: 12 }, (_, i) => i + 1).find((n) => !used.includes(n))
        if (!slot) throw new Error('All 12 Trader colours are in use. Retire a Trader first.')
        const modelId = ensureModel(db, t.model, now)
        const startedOn = s.experiment_state === 'setup' ? null : firstDecisionDate(db, now)
        const id = createTrader(db, { name: t.name, modelId, cadence: t.cadence, colourSlot: slot, startedOn, asOf: startedOn ?? marketDate(now), cashMicro: s.starting_cash_micro, now })
        return json({ id, startedOn, projection: projection(db, now, t.model, t.cadence) }, 201)
      }),
    },
    '/api/admin/traders/estimate': {
      POST: guarded(async (req) => {
        const t = newTraderFrom({ name: 'estimate', ...(await body(req)) })
        return json(projection(db, ctx.now(), t.model, t.cadence))
      }),
    },
    '/api/admin/traders/:id/retire': {
      POST: guarded((req) => {
        const id = Number(req.params?.id)
        const t = /** @type {{ status: string, kind: string, started_on: string | null } | null} */ (db.query('SELECT status, kind, started_on FROM traders WHERE id = ?').get(id))
        if (!t || t.kind !== 'ai') throw new Error('There is no Trader with that id.')
        if (t.status !== 'active') throw new Error('That Trader is already retired or retiring.')
        const now = ctx.now()
        if (!t.started_on) {
          db.run("UPDATE traders SET status = 'retired', retired_on = ? WHERE id = ?", [marketDate(now), id])
          return json({ status: 'retired' })
        }
        // Everything sells at the next open the Opening Bell hasn't rung yet.
        const today = marketDate(now)
        const bell = openingBellDue(db, today)
        const nextOpen = bell && bell > now ? today : nextTradingDay(db, today)
        const decisionDay = nextOpen ? previousTradingDay(db, nextOpen) : null
        if (!decisionDay) throw new Error('The market calendar has no next trading day loaded.')
        retireTrader(db, id, { date: decisionDay, now })
        return json({ status: 'retiring' })
      }),
    },
  }
}

/** @param {import('../agents/budget.js').Budget} b */
const budgetJson = (b) => ({ month: b.month, level: b.level, spentUsd: fromMicro(b.spentMicro), projectedUsd: fromMicro(b.projectedMicro), ceilingUsd: fromMicro(b.ceilingMicro) })

/**
 * @param {unknown} value
 * @param {string} what
 */
function positive(value, what) {
  const n = Number(value)
  if (!(n > 0)) throw new Error(`${what} must be more than zero.`)
  return n
}

/**
 * Check a new Trader's details from the request.
 * @param {Record<string, unknown>} b
 */
function newTraderFrom(b) {
  const name = String(b.name ?? '').trim()
  if (!name) throw new Error('Give the Trader a name.')
  const provider = String(b.provider ?? '')
  if (!(provider in KEY_NAMES)) throw new Error(`The provider must be one of: ${Object.keys(KEY_NAMES).join(', ')}.`)
  const cadence = b.cadence === 'weekly' ? 'weekly' : b.cadence === 'daily' ? 'daily' : null
  if (!cadence) throw new Error('The cadence must be daily or weekly.')
  const modelVersion = String(b.modelVersion ?? '').trim()
  if (!modelVersion) throw new Error('Give the exact model version.')
  const effort = ['low', 'medium', 'high', 'default'].includes(String(b.effort)) ? String(b.effort) : 'medium'
  return {
    name,
    cadence: /** @type {'daily' | 'weekly'} */ (cadence),
    model: { provider, model_version: modelVersion, effort, input: positive(b.inputUsdPerM, 'The input price'), cached: Number(b.cachedUsdPerM ?? 0) || 0, output: positive(b.outputUsdPerM, 'The output price') },
  }
}

/**
 * What adding a Trader on this model would do to the month's projected spend.
 * @param {Database} db
 * @param {Date} now
 * @param {{ input: number, cached: number, output: number }} m prices in dollars per million tokens
 * @param {'daily' | 'weekly'} cadence
 */
function projection(db, now, m, cadence) {
  const row = { id: 0, provider: '', model_version: '', effort: '', input_micro_per_mtok: toMicro(m.input), cached_input_micro_per_mtok: toMicro(m.cached), output_micro_per_mtok: toMicro(m.output) }
  const monthlyMicro = Math.round(costOf(row, TOKENS_PER_RUN) * RUNS_PER_MONTH[cadence])
  const b = budget(db, now)
  const projectedMicro = b.projectedMicro + monthlyMicro
  return {
    addedUsd: fromMicro(monthlyMicro),
    projectedUsd: fromMicro(projectedMicro),
    ceilingUsd: fromMicro(b.ceilingMicro),
    warning: projectedMicro >= b.ceilingMicro ? `Adding this Trader would take the projected monthly spend to $${fromMicro(projectedMicro).toFixed(2)}, past the $${fromMicro(b.ceilingMicro).toFixed(2)} ceiling.` : null,
  }
}

/**
 * New guardrails for every active AI Trader, from its next decision.
 * @param {Database} db
 * @param {Record<string, number>} changes
 * @param {Date} now
 */
function setGuardrails(db, changes, now) {
  const from = settings(db).experiment_state === 'setup' ? marketDate(now) : /** @type {string} */ (firstDecisionDate(db, now))
  const traders = db.query("SELECT id FROM traders WHERE kind = 'ai' AND status = 'active'").values().map(([id]) => Number(id))
  const upsert = db.prepare('INSERT INTO rule_sets (trader_id, rules, effective_from) VALUES (?, ?, ?) ON CONFLICT (trader_id, effective_from) DO UPDATE SET rules = excluded.rules')
  db.transaction(() => {
    for (const id of traders) upsert.run(id, JSON.stringify({ ...rulesFor(db, id, from), ...changes }), from)
  })()
}

/**
 * The next official open after an instant (today's, if it hasn't happened yet).
 * @param {import('bun:sqlite').Database} db
 * @param {Date} now
 */
function nextOpen(db, now) {
  const today = marketDate(now)
  const open = openInstant(db, today)
  if (open && open > now) return open.toISOString()
  const next = nextTradingDay(db, today)
  return next ? openInstant(db, next)?.toISOString() ?? null : null
}
