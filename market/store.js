// Saving market data. Every write is an upsert keyed on the natural key, so
// running the Floor Runner twice for a day changes nothing.

/** @typedef {import('bun:sqlite').Database} Database */
/** @typedef {import('./alpaca.js').Bar} Bar */
/** @typedef {import('./alpaca.js').NewsItem} NewsItem */
/** @typedef {import('./alpaca.js').CorporateAction} CorporateAction */

/**
 * @typedef {object} StockMenu
 * @property {string} version
 * @property {string} source
 * @property {Array<{ ticker: string, name: string, assetClass: string }>} instruments
 */

/**
 * Load the default stock menu the first time only. Later changes to the menu
 * belong to the Trade Master (Settings), so this never overwrites them.
 * @param {Database} db
 * @param {StockMenu} menu
 * @param {string} today
 * @returns {number} instruments added
 */
export function ensureStockMenu(db, menu, today) {
  const { stock_menu_version } = /** @type {{ stock_menu_version: string | null }} */ (db.query('SELECT stock_menu_version FROM settings WHERE id = 1').get())
  if (stock_menu_version) return 0
  const insert = db.prepare('INSERT OR IGNORE INTO instruments (ticker, name, asset_class, added_on) VALUES (?, ?, ?, ?)')
  let added = 0
  db.transaction(() => {
    for (const i of menu.instruments) added += insert.run(i.ticker, i.name, i.assetClass, today).changes
    db.run('UPDATE settings SET stock_menu_version = ?, updated_at = ? WHERE id = 1', [menu.version, new Date().toISOString()])
  })()
  return added
}

/**
 * @typedef {object} TrackedInstrument
 * @property {number} id
 * @property {string} ticker
 * @property {string} name
 * @property {string} asset_class
 * @property {number} on_menu
 */

/**
 * Instruments the Floor Runner collects data for: everything on the menu, plus
 * anything a Trader still holds (it can be sold after leaving the menu).
 * @param {Database} db
 * @returns {TrackedInstrument[]}
 */
export function trackedInstruments(db) {
  return /** @type {TrackedInstrument[]} */ (
    db.query(`SELECT id, ticker, name, asset_class, on_menu FROM instruments
              WHERE on_menu = 1 OR id IN (SELECT instrument_id FROM positions WHERE quantity_micro > 0)
              ORDER BY ticker`).all()
  )
}

/**
 * @param {Database} db
 * @returns {Map<string, number>} ticker → instrument id
 */
function instrumentIds(db) {
  return new Map(db.query('SELECT ticker, id FROM instruments').values().map(([t, id]) => [String(t), Number(id)]))
}

/**
 * @param {Database} db
 * @param {Array<{ date: string, open: string, close: string }>} days
 * @param {string} [calendar]
 */
export function saveCalendar(db, days, calendar = 'XNYS') {
  const upsert = db.prepare(`INSERT INTO trading_days (calendar, date, open_time, close_time, early_close) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (calendar, date) DO UPDATE SET open_time = excluded.open_time, close_time = excluded.close_time, early_close = excluded.early_close`)
  db.transaction(() => {
    for (const d of days) upsert.run(calendar, d.date, d.open, d.close, d.close < '16:00' ? 1 : 0)
  })()
}

/**
 * The source of a bar saved at the open: its open is official, the rest is
 * not final until the Floor Runner stores the full day after the close.
 */
export const PARTIAL_BAR = 'alpaca-open'

/** @param {number} n */
const price = (n) => Number.isSafeInteger(n) && n > 0

/**
 * Save daily bars. A bar with a missing, zero or negative price is left out.
 * @param {Database} db
 * @param {Bar[]} bars
 * @param {string} source
 */
export function saveBars(db, bars, source) {
  const ids = instrumentIds(db)
  const upsert = db.prepare(`INSERT INTO daily_bars (instrument_id, date, open_micro, high_micro, low_micro, close_micro, volume, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (instrument_id, date) DO UPDATE SET open_micro = excluded.open_micro, high_micro = excluded.high_micro,
      low_micro = excluded.low_micro, close_micro = excluded.close_micro, volume = excluded.volume, source = excluded.source`)
  db.transaction(() => {
    for (const b of bars) {
      const id = ids.get(b.ticker)
      if (!id || ![b.openMicro, b.highMicro, b.lowMicro, b.closeMicro].every(price) || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) continue
      upsert.run(id, b.date, b.openMicro, b.highMicro, b.lowMicro, b.closeMicro, Number.isSafeInteger(b.volume) ? b.volume : 0, source)
    }
  })()
}

/**
 * Headlines are stored as written (they are untrusted text, shown to models
 * only as data). Times are normalised to ISO UTC with milliseconds so they
 * compare correctly as text. Links are kept only for tickers we know.
 * @param {Database} db
 * @param {NewsItem[]} items
 */
export function saveNews(db, items) {
  const ids = instrumentIds(db)
  const insert = db.prepare(`INSERT INTO news_items (external_id, headline, summary, source, url, published_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (external_id) DO NOTHING RETURNING id`)
  const existing = db.prepare('SELECT id FROM news_items WHERE external_id = ?')
  const link = db.prepare('INSERT OR IGNORE INTO news_tickers (news_id, instrument_id) VALUES (?, ?)')
  db.transaction(() => {
    for (const n of items) {
      const row = /** @type {{ id: number } | null} */ (insert.get(n.externalId, n.headline, n.summary, n.source, n.url, new Date(n.publishedAt).toISOString()) ?? existing.get(n.externalId))
      if (!row) continue
      for (const ticker of n.tickers) {
        const id = ids.get(ticker)
        if (id) link.run(row.id, id)
      }
    }
  })()
}

/**
 * Announced actions can be revised until they are applied; once the Opening
 * Bell has booked one, it stays as it was booked, so replaying the books gives
 * the same answer later.
 * @param {Database} db
 * @param {CorporateAction[]} actions
 */
export function saveCorporateActions(db, actions) {
  const ids = instrumentIds(db)
  const upsert = db.prepare(`INSERT INTO corporate_actions (instrument_id, kind, ex_date, pay_date, split_from, split_to, cash_per_share_micro)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (instrument_id, kind, ex_date) DO UPDATE SET pay_date = excluded.pay_date, split_from = excluded.split_from,
      split_to = excluded.split_to, cash_per_share_micro = excluded.cash_per_share_micro
    WHERE NOT EXISTS (SELECT 1 FROM cash_ledger l WHERE l.corporate_action_id = corporate_actions.id)`)
  db.transaction(() => {
    for (const a of actions) {
      const id = ids.get(a.ticker)
      if (id) upsert.run(id, a.kind, a.exDate, a.payDate, a.splitFrom, a.splitTo, a.cashPerShareMicro)
    }
  })()
}
