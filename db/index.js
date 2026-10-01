import { Database } from 'bun:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MIGRATIONS_DIR = join(import.meta.dir, 'migrations')

/**
 * Open the SQLite database with the settings every connection needs.
 * Pass ':memory:' for tests.
 * @param {string} path
 * @returns {Database}
 */
export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { create: true, strict: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run('PRAGMA busy_timeout = 5000')
  return db
}

/**
 * Apply every numbered migration in db/migrations that has not run yet, in
 * order, each in its own transaction. Safe to call on every start.
 * @param {Database} db
 * @returns {string[]} names of the migrations applied by this call
 */
export function migrate(db) {
  db.run('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const done = new Set(db.query('SELECT name FROM schema_migrations').values().map(([name]) => String(name)))
  const files = [...new Bun.Glob('*.sql').scanSync(MIGRATIONS_DIR)].sort()
  const applied = []

  for (const name of files) {
    if (done.has(name)) continue
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
    db.transaction(() => {
      db.run(sql)
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [name, new Date().toISOString()])
    })()
    applied.push(name)
  }
  return applied
}
