import { describe, expect, test } from 'bun:test'
import { openDb, migrate } from '../db/index.js'

describe('migrations', () => {
  test('apply on an empty database and record themselves', () => {
    const db = openDb(':memory:')
    const applied = migrate(db)
    expect(applied).toContain('0001_initial.sql')
    const recorded = db.query('SELECT name FROM schema_migrations').values().flat()
    expect(recorded).toEqual(applied)
  })

  test('running again applies nothing', () => {
    const db = openDb(':memory:')
    migrate(db)
    expect(migrate(db)).toEqual([])
  })

  test('create every table in the data model', () => {
    const db = openDb(':memory:')
    migrate(db)
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").values().flat()
    for (const table of [
      'instruments', 'trading_days', 'daily_bars', 'news_items', 'news_tickers', 'corporate_actions',
      'briefing_packs', 'models', 'traders', 'rule_sets', 'runs', 'decisions', 'orders', 'fills',
      'positions', 'cash_ledger', 'snapshots', 'metrics', 'badges', 'columnist_posts', 'step_runs',
      'settings', 'trade_master', 'sessions',
    ]) {
      expect(tables).toContain(table)
    }
  })

  test('start with one settings row: setup state, $1,000 cash, $25 ceiling, Gallery off', () => {
    const db = openDb(':memory:')
    migrate(db)
    expect(db.query('SELECT experiment_state, starting_cash_micro, budget_ceiling_micro, gallery_enabled FROM settings').all()).toEqual([
      { experiment_state: 'setup', starting_cash_micro: 1_000_000_000, budget_ceiling_micro: 25_000_000, gallery_enabled: 0 },
    ])
  })

  test('enforce foreign keys', () => {
    const db = openDb(':memory:')
    migrate(db)
    expect(() => db.run("INSERT INTO rule_sets (trader_id, rules, effective_from) VALUES (999, '{}', '2026-10-01')")).toThrow()
  })

  test('an AI Trader must have a model; The Index need not', () => {
    const db = openDb(':memory:')
    migrate(db)
    expect(() => db.run("INSERT INTO traders (name, kind, cadence) VALUES ('Claude daily', 'ai', 'daily')")).toThrow()
    db.run("INSERT INTO traders (name, kind, cadence) VALUES ('The Index', 'benchmark', 'daily')")
  })
})
