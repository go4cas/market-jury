import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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

  test('the 19 Oct weekend batch takes PSKY and WBD off the menu and logs its changes, only for an experiment already running', () => {
    const batch = readFileSync(new URL('../db/migrations/0009_weekend_batch_2026_10_19.sql', import.meta.url), 'utf8')
    const db = openDb(':memory:')
    migrate(db)
    // A fresh install (no start date) gets nothing from it.
    expect(db.query('SELECT COUNT(*) AS n FROM platform_changes').get()).toEqual({ n: 0 })
    // The live experiment, started 5 Oct with PSKY on the menu: replay the batch against it.
    db.run("UPDATE settings SET start_date = '2026-10-05' WHERE id = 1")
    db.run("INSERT INTO instruments (ticker, name, added_on) VALUES ('PSKY', 'Paramount Skydance', '2026-10-01'), ('AAPL', 'Apple', '2026-10-01')")
    db.run(batch)
    expect(db.query('SELECT ticker, on_menu, removed_on FROM instruments ORDER BY ticker').all()).toEqual([
      { ticker: 'AAPL', on_menu: 1, removed_on: null },
      { ticker: 'PSKY', on_menu: 0, removed_on: '2026-10-19' },
    ])
    expect(db.query("SELECT COUNT(*) AS n FROM platform_changes WHERE effective_on = '2026-10-19'").get()).toEqual({ n: 5 })
  })

  test('the 26 Oct weekend batch logs its changes only for an experiment already running', () => {
    const batch = readFileSync(new URL('../db/migrations/0011_weekend_batch_2026_10_26.sql', import.meta.url), 'utf8')
    const db = openDb(':memory:')
    migrate(db)
    expect(db.query("SELECT COUNT(*) AS n FROM platform_changes WHERE effective_on = '2026-10-26'").get()).toEqual({ n: 0 })
    db.run("UPDATE settings SET start_date = '2026-10-05' WHERE id = 1")
    db.run(batch)
    expect(db.query("SELECT area, pr_number FROM platform_changes WHERE effective_on = '2026-10-26'").all()).toEqual([{ area: 'Briefing pack', pr_number: 44 }, { area: 'Briefing pack', pr_number: 44 }, { area: 'Prompt', pr_number: 44 }])
  })
})
