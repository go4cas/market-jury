// Starts the Bun server for Playwright with a fresh database, a known Trade
// Master, and a week of the experiment (fake market data, recorded answers).
import { createHash } from 'node:crypto'
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate } from '../../../db/index.js'
import { startServer } from '../../../server/app.js'
import { runSampleWeek } from '../../../tests/sample-week.js'
import { E2E_PASSWORD, E2E_SESSION_TOKEN, E2E_TOTP_SECRET } from './fixtures.js'

const dir = mkdtempSync(join(tmpdir(), 'mj-e2e-'))
const db = openDb(join(dir, 'e2e.sqlite'))
migrate(db)
db.run('INSERT INTO trade_master (id, password_hash, totp_secret, updated_at) VALUES (1, ?, ?, ?)', [
  await Bun.password.hash(E2E_PASSWORD),
  E2E_TOTP_SECRET,
  new Date().toISOString(),
])

db.run('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)', [
  createHash('sha256').update(E2E_SESSION_TOKEN).digest('hex'),
  new Date().toISOString(),
  new Date(Date.now() + 86_400_000).toISOString(),
])
await runSampleWeek(db)

const server = startServer({ db, port: Number(process.env.PORT), clientDir: 'dist' })
console.log(`E2E server on ${server.url}`)

process.on('SIGTERM', () => {
  server.stop()
  rmSync(dir, { recursive: true, force: true })
  process.exit(0)
})
