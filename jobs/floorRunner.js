// The Floor Runner: after the close, collect the day's prices, headlines and
// corporate actions, then build the briefing pack (and the weekly pack after
// the week's last trading day). Safe to run again for the same day.
import { closeInstant, isLastTradingDayOfWeek, isTradingDay, previousTradingDay, tradingDaysBack } from '../core/calendar.js'
import { ensureStockMenu, saveBars, saveCalendar, saveCorporateActions, saveNews, trackedInstruments } from '../market/store.js'
import { buildDailyPack, buildWeeklyPack, packExists, savePack } from '../market/briefingPack.js'
import defaultMenu from '../market/stock-menu.json'

/** @typedef {import('bun:sqlite').Database} Database */
/** @typedef {import('../market/alpaca.js').Alpaca} Alpaca */
/** @typedef {import('../market/store.js').StockMenu} StockMenu */

export const CALENDAR_END = '2029-12-31'
const HISTORY_TRADING_DAYS = 63 // the 3-month change
const CORPORATE_ACTIONS_AHEAD_DAYS = 45
const NEWS_MAX = 1000

/** @param {string} date @param {number} days */
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * @param {object} options
 * @param {Database} options.db
 * @param {Alpaca} options.alpaca
 * @param {string} options.date the trading day to collect (New York date)
 * @param {StockMenu} [options.menu] the default menu, loaded on the very first run
 * @param {() => Date} [options.now]
 * @returns {Promise<{ daily: number | null, weekly: number | null, skipped?: string }>}
 */
export async function runFloorRunner({ db, alpaca, date, menu = defaultMenu, now = () => new Date() }) {
  ensureStockMenu(db, menu, date)

  // The calendar: fetch once, far enough back for three months of history and forward to 2029.
  const calendarReaches = db.query("SELECT 1 FROM trading_days WHERE calendar = 'XNYS' AND date >= ?").get(addDays(date, 30))
  const calendarStarts = db.query("SELECT 1 FROM trading_days WHERE calendar = 'XNYS' AND date <= ?").get(addDays(date, -120))
  if (!calendarReaches || !calendarStarts) saveCalendar(db, await alpaca.calendar(addDays(date, -150), CALENDAR_END))

  if (!isTradingDay(db, date)) return { daily: null, weekly: null, skipped: `The market is closed on ${date}.` }

  const weekly = isLastTradingDayOfWeek(db, date)
  if (packExists(db, 'daily', date) && (!weekly || packExists(db, 'weekly', date))) {
    return { daily: packId(db, 'daily', date), weekly: weekly ? packId(db, 'weekly', date) : null }
  }

  const tickers = trackedInstruments(db).map((i) => i.ticker)

  // Prices: everything since the last stored day, reaching back three months on the first run.
  const historyStart = /** @type {string} */ (tradingDaysBack(db, date, HISTORY_TRADING_DAYS) ?? addDays(date, -100))
  const lastStored = /** @type {{ last: string | null }} */ (db.query('SELECT MAX(date) AS last FROM daily_bars WHERE date < ?').get(date)).last
  const barsFrom = lastStored && lastStored > historyStart ? addDays(lastStored, 1) : historyStart
  saveBars(db, await alpaca.dailyBars(tickers, barsFrom, date), 'alpaca')

  // Headlines published since the previous close.
  const previous = previousTradingDay(db, date)
  const close = /** @type {Date} */ (closeInstant(db, date))
  const newsFrom = previous ? /** @type {Date} */ (closeInstant(db, previous)) : new Date(close.getTime() - 86_400_000)
  saveNews(db, await alpaca.news(newsFrom, close, { max: NEWS_MAX }))

  // Splits and dividends from the past week to the coming weeks (announced ones).
  saveCorporateActions(db, await alpaca.corporateActions(tickers, addDays(date, -7), addDays(date, CORPORATE_ACTIONS_AHEAD_DAYS)))

  const { stock_menu_version: menuVersion } = /** @type {{ stock_menu_version: string | null }} */ (db.query('SELECT stock_menu_version FROM settings WHERE id = 1').get())
  const context = { menuVersion, now: now() }
  const daily = savePack(db, buildDailyPack(db, date, context))
  return { daily, weekly: weekly ? savePack(db, buildWeeklyPack(db, date, context)) : null }
}

/** @param {Database} db @param {string} kind @param {string} date */
function packId(db, kind, date) {
  return /** @type {{ id: number }} */ (db.query('SELECT id FROM briefing_packs WHERE kind = ? AND trading_date = ?').get(kind, date)).id
}
