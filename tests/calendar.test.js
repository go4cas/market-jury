import { beforeEach, describe, expect, test } from 'bun:test'
import {
  isTradingDay, previousTradingDay, nextTradingDay, tradingDaysBack, tradingDaysBetween,
  isLastTradingDayOfWeek, firstTradingDayOfWeek, closeInstant, openInstant, marketDate, zonedTimeToUtc,
} from '../core/calendar.js'
import { testDb } from './helpers.js'

/** @type {import('bun:sqlite').Database} */
let db

// Late November 2026: Thanksgiving (Thu 26) closed, Black Friday (27) closes at 13:00.
const DAYS = [
  ['2026-11-19', '09:30', '16:00'], ['2026-11-20', '09:30', '16:00'],
  ['2026-11-23', '09:30', '16:00'], ['2026-11-24', '09:30', '16:00'], ['2026-11-25', '09:30', '16:00'],
  ['2026-11-27', '09:30', '13:00'],
  ['2026-11-30', '09:30', '16:00'], ['2026-12-01', '09:30', '16:00'],
]

beforeEach(() => {
  db = testDb()
  for (const [date, open, close] of DAYS) {
    db.run('INSERT INTO trading_days (calendar, date, open_time, close_time, early_close) VALUES (?, ?, ?, ?, ?)', [
      'XNYS', date, open, close, close === '16:00' ? 0 : 1,
    ])
  }
})

describe('trading days', () => {
  test('knows holidays and weekends are not trading days', () => {
    expect(isTradingDay(db, '2026-11-25')).toBe(true)
    expect(isTradingDay(db, '2026-11-26')).toBe(false)
    expect(isTradingDay(db, '2026-11-28')).toBe(false)
  })

  test('steps over holidays and weekends', () => {
    expect(nextTradingDay(db, '2026-11-25')).toBe('2026-11-27')
    expect(previousTradingDay(db, '2026-11-30')).toBe('2026-11-27')
    expect(previousTradingDay(db, '2026-11-26')).toBe('2026-11-25')
    expect(nextTradingDay(db, '2026-12-01')).toBeNull()
  })

  test('counts back a number of trading days', () => {
    expect(tradingDaysBack(db, '2026-12-01', 0)).toBe('2026-12-01')
    expect(tradingDaysBack(db, '2026-12-01', 3)).toBe('2026-11-25')
    expect(tradingDaysBack(db, '2026-12-01', 50)).toBeNull()
  })

  test('lists the trading days in a range', () => {
    expect(tradingDaysBetween(db, '2026-11-24', '2026-11-30')).toEqual(['2026-11-24', '2026-11-25', '2026-11-27', '2026-11-30'])
  })

  test('a short holiday week ends on its last trading day', () => {
    expect(isLastTradingDayOfWeek(db, '2026-11-25')).toBe(false)
    expect(isLastTradingDayOfWeek(db, '2026-11-27')).toBe(true)
    expect(isLastTradingDayOfWeek(db, '2026-11-20')).toBe(true)
    expect(firstTradingDayOfWeek(db, '2026-11-27')).toBe('2026-11-23')
  })
})

describe('times', () => {
  test('converts New York wall time to UTC across the US clock change', () => {
    expect(zonedTimeToUtc('2026-10-14', '16:00', 'America/New_York').toISOString()).toBe('2026-10-14T20:00:00.000Z')
    expect(zonedTimeToUtc('2026-11-20', '16:00', 'America/New_York').toISOString()).toBe('2026-11-20T21:00:00.000Z')
    // 1 November 2026 is the change itself: 09:30 is already standard time.
    expect(zonedTimeToUtc('2026-11-01', '09:30', 'America/New_York').toISOString()).toBe('2026-11-01T14:30:00.000Z')
  })

  test('gives the open and close of a trading day, early closes included', () => {
    expect(openInstant(db, '2026-11-27')?.toISOString()).toBe('2026-11-27T14:30:00.000Z')
    expect(closeInstant(db, '2026-11-27')?.toISOString()).toBe('2026-11-27T18:00:00.000Z')
    expect(closeInstant(db, '2026-11-26')).toBeNull()
  })

  test('reads the New York market date of an instant', () => {
    expect(marketDate(new Date('2026-11-25T04:00:00Z'))).toBe('2026-11-24')
    expect(marketDate(new Date('2026-11-25T05:00:00Z'))).toBe('2026-11-25')
  })
})
