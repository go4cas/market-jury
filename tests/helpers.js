import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate } from '../db/index.js'
import { startServer } from '../server/app.js'

/** A migrated in-memory database. */
export function testDb() {
  const db = openDb(':memory:')
  migrate(db)
  return db
}

/** A throwaway "built client" folder with an index.html and one asset. */
export function testClientDir() {
  const dir = mkdtempSync(join(tmpdir(), 'mj-client-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Market Jury</title>')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  return dir
}

/**
 * A running server on a free port with a fresh database.
 * @param {{ now?: () => number }} [options]
 */
export function testServer(options = {}) {
  const db = testDb()
  const server = startServer({ db, port: 0, clientDir: testClientDir(), ...options })
  /** @param {string} path @param {RequestInit} [init] */
  const request = (path, init) => fetch(new URL(path, server.url), init)
  return { db, server, request }
}
