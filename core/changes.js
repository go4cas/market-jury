// The change log: what changed for the Traders, and from which trading day.
// Rows arrive by migration with each weekend batch (db/migrations).

/** @typedef {import('bun:sqlite').Database} Database */

/**
 * The change log, newest first, optionally only what took effect in [from, to].
 * @param {Database} db
 * @param {{ from?: string, to?: string }} [range]
 * @returns {Array<{ effectiveOn: string, area: string, summary: string, prNumber: number | null }>}
 */
export function platformChanges(db, { from = '0000-01-01', to = '9999-12-31' } = {}) {
  return /** @type {any} */ (db.query(`SELECT effective_on AS effectiveOn, area, summary, pr_number AS prNumber FROM platform_changes
                                       WHERE effective_on BETWEEN ? AND ? ORDER BY effective_on DESC, id DESC`).all(from, to))
}
