import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expiredKeys, snapshot, snapshotKey } from '../scripts/backup.js'
import { testDb } from './helpers.js'

describe('backup', () => {
  test('snapshots a database with its data and migrations', () => {
    const db = testDb()
    db.run('UPDATE settings SET gallery_enabled = 1 WHERE id = 1')
    const path = join(mkdtempSync(join(tmpdir(), 'mj-backup-test-')), 'copy.sqlite')

    snapshot(db, path)

    const copy = new Database(path, { readonly: true })
    expect(copy.query('SELECT gallery_enabled FROM settings WHERE id = 1').get()).toEqual({ gallery_enabled: 1 })
    expect(copy.query('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 1 })
  })

  test('names snapshots by UTC time so they sort in order', () => {
    expect(snapshotKey(new Date('2026-10-01T02:00:05.123Z'))).toBe('snapshots/2026-10-01T020005Z.sqlite.gz')
  })

  test('expires snapshots older than 30 days and leaves anything else alone', () => {
    const now = new Date('2026-10-31T02:00:00Z')
    const keys = [
      snapshotKey(new Date('2026-09-30T02:00:00Z')),
      snapshotKey(new Date('2026-10-01T01:59:59Z')),
      snapshotKey(new Date('2026-10-01T02:00:00Z')),
      snapshotKey(new Date('2026-10-30T02:00:00Z')),
      'snapshots/restored-by-hand.sqlite',
      'notes.txt',
    ]
    expect(expiredKeys(keys, now)).toEqual(['snapshots/2026-09-30T020000Z.sqlite.gz', 'snapshots/2026-10-01T015959Z.sqlite.gz'])
  })
})
