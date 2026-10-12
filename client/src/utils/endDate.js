import { day } from './format.js'

/**
 * What the Settings page knows about the experiment's last trading day.
 * `tradingDays` runs from day one, so a day's number is its place in the list plus one.
 * @typedef {{ today: string, endDate: string | null, endDay: number | null, paperPhaseDays: number, tradingDays: string[] }} EndInfo
 */

/**
 * The quick picks in the Change dialog, as trading days after day one; any
 * whose day has passed is left out.
 * @param {EndInfo} info
 * @returns {Array<{ label: string, date: string }>}
 */
export function quickPicks(info) {
  /** @type {Array<[string, number]>} */
  const picks = [['6 weeks', 30], ['8 weeks', 40], ['3 months', info.paperPhaseDays]]
  return picks
    .map(([label, n]) => ({ label, date: info.tradingDays[n - 1] }))
    .filter((p) => p.date && p.date > info.today)
}

/** The first trading day after today: the earliest the last day can be. @param {EndInfo} info */
export const firstChoice = (info) => info.tradingDays.find((d) => d > info.today) ?? null

/**
 * Check a picked date the way the server does, and count it for the hint.
 * @param {EndInfo} info
 * @param {string} date 'YYYY-MM-DD', or '' when the field is empty
 * @returns {{ ok: false, error: string } | { ok: true, date: string, day: number, weeks: number, fromToday: number }}
 */
export function checkEnd(info, date) {
  if (!date || date <= info.today) return { ok: false, error: 'Pick a trading day after today.' }
  const last = info.tradingDays.at(-1)
  if (!last || date > last) return { ok: false, error: `The market calendar only runs to ${day(last ?? info.today)}. Pick an earlier trading day.` }
  const i = info.tradingDays.indexOf(date)
  if (i < 0) return { ok: false, error: `Markets are closed on ${day(date)}. Pick a trading day.` }
  return { ok: true, date, day: i + 1, weeks: Math.round((i + 1) / 5), fromToday: info.tradingDays.filter((d) => d > info.today && d <= date).length }
}

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * "Day 30 · 6 weeks of trading · 24 trading days from today".
 * @param {{ day: number, weeks: number, fromToday: number }} c
 */
export const endHint = (c) => `Day ${c.day} · ${plural(c.weeks, 'week', 'weeks')} of trading · ${plural(c.fromToday, 'trading day', 'trading days')} from today`
