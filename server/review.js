// The weekly platform review's data: one read-only JSON export of the trading
// record, so the review can run in the cloud without a backup download. It is
// guarded by its own token (REVIEW_TOKEN), not the Gallery or the Trade Master
// cookie, and answers 404 while no token is set (fail closed). Login tables
// (trade_master, sessions) are never read here.
import { timingSafeEqual } from 'node:crypto'
import { error, json } from './http.js'

/** @typedef {import('bun:sqlite').Database} Database */

const DATE = /^\d{4}-\d{2}-\d{2}$/
/** Model calls for a trading day finish after its date (the evening run, the weekly report), so runs reach a few days past `to`. */
const RUN_DAYS_AFTER = 3

/**
 * @param {Database} db
 * @param {{ token?: string }} options
 */
export function reviewRoutes(db, { token }) {
  const expected = token ? digest(token) : null
  return {
    '/api/review/export': {
      GET: (/** @type {Request} */ req) => {
        if (!expected) return error(404, 'There is nothing at this address.')
        const given = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
        if (!given || !timingSafeEqual(digest(given), expected)) return error(401, 'The review token is missing or wrong.')
        const url = new URL(req.url)
        const from = url.searchParams.get('from')
        const to = url.searchParams.get('to')
        if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return error(400, 'Give from and to as dates like 2026-10-19.')
        return json(reviewExport(db, { from, to }))
      },
    },
  }
}

/** @param {string} text */
const digest = (text) => new Bun.CryptoHasher('sha256').update(text).digest()

/**
 * Everything the weekly review reads, for the trading days from..to (default:
 * the whole experiment so far). Small tables come whole; model calls and
 * briefing packs, the bulky ones, only for the range.
 * @param {Database} db
 * @param {{ from?: string | null, to?: string | null }} range
 */
export function reviewExport(db, range) {
  /** @param {string} sql @param {...(string | number)} params */
  const all = (sql, ...params) => db.query(sql).all(...params)
  const settings = /** @type {Record<string, any>} */ (db.query('SELECT * FROM settings WHERE id = 1').get())
  const latest = /** @type {{ d: string | null }} */ (db.query('SELECT MAX(trading_date) d FROM snapshots').get()).d
  const from = range.from ?? settings.start_date ?? '0000-00-00'
  const to = range.to ?? latest ?? '9999-12-31'

  return {
    from,
    to,
    exportedAt: new Date().toISOString(),
    settings: {
      state: settings.experiment_state,
      startDate: settings.start_date,
      endDate: settings.end_date,
      startingCashMicro: settings.starting_cash_micro,
      budgetCeilingMicro: settings.budget_ceiling_micro,
      galleryEnabled: settings.gallery_enabled === 1,
      stockMenuVersion: settings.stock_menu_version,
      columnistDailyModelId: settings.columnist_daily_model_id,
      columnistWeeklyModelId: settings.columnist_weekly_model_id,
      defaultRules: settings.default_rules,
    },
    models: all('SELECT * FROM models ORDER BY id'),
    traders: all('SELECT * FROM traders ORDER BY id'),
    instruments: all('SELECT * FROM instruments ORDER BY id'),
    rule_sets: all('SELECT * FROM rule_sets ORDER BY id'),
    step_runs: all('SELECT * FROM step_runs ORDER BY id'),
    runs: all(`SELECT id, kind, trader_id, model_id, pack_id, dry_run, status, attempt, prompt, response, tokens_in, tokens_out, tokens_cached, cost_micro, error, started_at, finished_at
               FROM runs WHERE substr(started_at, 1, 10) BETWEEN ? AND date(?, '+${RUN_DAYS_AFTER} days') ORDER BY id`, from, to)
      .map((/** @type {any} */ { prompt, ...run }) => ({ ...run, prompt_tail: promptTail(prompt) })),
    briefing_packs: all('SELECT * FROM briefing_packs WHERE trading_date BETWEEN ? AND ? ORDER BY id', from, to),
    decisions: all('SELECT * FROM decisions ORDER BY id'),
    orders: all('SELECT * FROM orders ORDER BY id'),
    fills: all('SELECT * FROM fills ORDER BY id'),
    positions: all('SELECT * FROM positions ORDER BY trader_id, instrument_id'),
    snapshots: all('SELECT * FROM snapshots ORDER BY trading_date, trader_id'),
    metrics: all('SELECT * FROM metrics ORDER BY trading_date, trader_id, key'),
    badges: all('SELECT * FROM badges ORDER BY period_end, period_kind, badge'),
    columnist_posts: all('SELECT * FROM columnist_posts ORDER BY id'),
    corporate_actions: all('SELECT * FROM corporate_actions ORDER BY id'),
    cash_ledger: all('SELECT * FROM cash_ledger ORDER BY id'),
    platform_changes: all('SELECT * FROM platform_changes ORDER BY id'),
    news_per_day: all(`SELECT substr(published_at, 1, 10) AS day, COUNT(*) AS items FROM news_items
                       WHERE substr(published_at, 1, 10) BETWEEN date(?, '-3 days') AND ? GROUP BY day ORDER BY day`, from, to),
  }
}

/**
 * The part of a stored prompt that differs per call: for a Trader, everything
 * after the shared briefing pack (portfolio, recent decisions, journal); for
 * the Columnist, its whole message. The system instructions are left out
 * (they are the same for every call and live in the code).
 * @param {string | null} prompt the JSON `{ system, messages }` that agents/call.js stores
 */
export function promptTail(prompt) {
  if (!prompt) return null
  /** @type {{ messages?: { content: string | { type: string, text?: string }[] }[] }} */
  let parsed
  try {
    parsed = JSON.parse(prompt)
  } catch {
    return null
  }
  const text = (parsed.messages ?? [])
    .map((m) => typeof m.content === 'string' ? m.content : m.content.map((part) => part.text ?? '').join('\n\n'))
    .join('\n\n')
  const end = text.lastIndexOf('</briefing_pack>')
  return end === -1 ? text : text.slice(end + '</briefing_pack>'.length).trim()
}
