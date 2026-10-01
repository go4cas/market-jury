// Starts the Bun server for Playwright with a fresh database and a known Trade Master.
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate } from '../../../db/index.js'
import { startServer } from '../../../server/app.js'
import { E2E_PASSWORD, E2E_TOTP_SECRET } from './fixtures.js'

const dir = mkdtempSync(join(tmpdir(), 'mj-e2e-'))
const db = openDb(join(dir, 'e2e.sqlite'))
migrate(db)
db.run('INSERT INTO trade_master (id, password_hash, totp_secret, updated_at) VALUES (1, ?, ?, ?)', [
  await Bun.password.hash(E2E_PASSWORD),
  E2E_TOTP_SECRET,
  new Date().toISOString(),
])

const server = startServer({ db, port: Number(process.env.PORT), clientDir: 'dist' })
console.log(`E2E server on ${server.url}`)

process.on('SIGTERM', () => {
  server.stop()
  rmSync(dir, { recursive: true, force: true })
  process.exit(0)
})
