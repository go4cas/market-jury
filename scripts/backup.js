// Nightly backup: a consistent snapshot of the SQLite database (VACUUM INTO), gzipped and
// uploaded to Cloudflare R2. Snapshots older than KEEP_DAYS are removed.
// Run on the server by the market-jury-backup systemd timer (see deploy/provision.sh).
// Bun's S3 client reads S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT and S3_BUCKET
// from the environment file; the backup refuses to run without them.
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../server/config.js'

export const PREFIX = 'snapshots/'
export const KEEP_DAYS = 30

/**
 * Write a consistent copy of the database to `path`, safe while the app is writing.
 * @param {Database} db
 * @param {string} path
 */
export function snapshot(db, path) {
  db.run('VACUUM INTO ?', [path])
}

/**
 * The R2 key for a snapshot taken at `time`, e.g. snapshots/2026-10-01T020000Z.sqlite.gz.
 * Keys sort by time, and the time is read back from the key to expire old snapshots.
 * @param {Date} time
 */
export function snapshotKey(time) {
  return `${PREFIX}${time.toISOString().slice(0, 19).replaceAll(':', '')}Z.sqlite.gz`
}

/**
 * Snapshot keys older than `keepDays` before `now`. Keys that are not snapshots are left alone.
 * @param {string[]} keys
 * @param {Date} now
 * @param {number} [keepDays]
 */
export function expiredKeys(keys, now, keepDays = KEEP_DAYS) {
  const cutoff = now.getTime() - keepDays * 86_400_000
  return keys.filter((key) => {
    const m = key.match(/^snapshots\/(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z\.sqlite\.gz$/)
    return m !== null && Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) < cutoff
  })
}

if (import.meta.main) {
  const missing = ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'S3_BUCKET'].filter((name) => !process.env[name])
  if (missing.length) {
    console.error(`No backup was made: ${missing.join(', ')} missing from the server's environment file.`)
    process.exit(1)
  }

  const now = new Date()
  const dir = mkdtempSync(join(tmpdir(), 'mj-backup-'))
  try {
    const file = join(dir, 'snapshot.sqlite')
    const db = new Database(config.dbPath, { readwrite: true })
    snapshot(db, file)
    db.close()

    const key = snapshotKey(now)
    const bytes = Bun.gzipSync(await Bun.file(file).bytes())
    await Bun.s3.write(key, bytes)
    console.log(`Uploaded ${key} (${bytes.length} bytes).`)

    const listed = await Bun.s3.list({ prefix: PREFIX })
    const keys = (listed.contents ?? []).map((object) => object.key)
    for (const old of expiredKeys(keys, now)) {
      await Bun.s3.delete(old)
      console.log(`Removed ${old}.`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
