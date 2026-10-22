// The budget guard (PRD): every run's cost is recorded; the month's spend so
// far is projected to the month's end. At 90% of the ceiling the Trade Master
// is warned; at 100% the Traders who search the web, the weekly Traders and the
// Columnist's daily recap pause, while the other daily Traders keep running.

/** @typedef {import('bun:sqlite').Database} Database */

/**
 * @typedef {object} Budget
 * @property {string} month 'YYYY-MM' (UTC)
 * @property {number} spentMicro month to date, dry runs included
 * @property {number} projectedMicro at the current pace, by the month's end
 * @property {number} ceilingMicro
 * @property {'ok' | 'warning' | 'over'} level
 */

/**
 * @param {Database} db
 * @param {Date} now
 * @returns {Budget}
 */
export function budget(db, now) {
  const month = now.toISOString().slice(0, 7)
  const { spent } = /** @type {{ spent: number }} */ (db.query('SELECT COALESCE(SUM(cost_micro), 0) AS spent FROM runs WHERE substr(started_at, 1, 7) = ?').get(month))
  const { budget_ceiling_micro: ceiling } = /** @type {{ budget_ceiling_micro: number }} */ (db.query('SELECT budget_ceiling_micro FROM settings WHERE id = 1').get())
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const projected = Math.round((spent / now.getUTCDate()) * daysInMonth)
  const level = projected >= ceiling ? 'over' : projected >= ceiling * 0.9 ? 'warning' : 'ok'
  return { month, spentMicro: spent, projectedMicro: projected, ceilingMicro: ceiling, level }
}

/**
 * May this kind of run go ahead, given the budget? A Trader in a Track with
 * web search costs the most, so it pauses first.
 * @param {Budget} b
 * @param {'daily trader' | 'weekly trader' | 'daily recap' | 'weekly report'} kind
 * @param {{ searches?: boolean }} [options] searches: the Trader's Track allows web search
 */
export const mayRun = (b, kind, { searches = false } = {}) => b.level !== 'over' || (!searches && (kind === 'daily trader' || kind === 'weekly report'))
