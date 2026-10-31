import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { startServer } from '../server/app.js'
import { promptTail } from '../server/review.js'
import { testClientDir, testDb } from './helpers.js'
import { runSampleWeek } from './sample-week.js'

const TOKEN = 'review-token-for-tests'

/** @type {import('bun:sqlite').Database} */
let db
/** @type {ReturnType<typeof startServer>} */
let server
/** @type {ReturnType<typeof startServer>} */
let shut

/**
 * @param {ReturnType<typeof startServer>} on
 * @param {string} path
 * @param {string} [token]
 */
const get = async (on, path, token) => {
  const res = await fetch(new URL(path, on.url), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  return { status: res.status, text: await res.text() }
}

beforeAll(async () => {
  db = testDb()
  db.run("INSERT INTO trade_master (id, password_hash, totp_secret, updated_at) VALUES (1, 'secret-password-hash', 'SECRETTOTPSEED', 'x')")
  db.run("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES ('secret-session-hash', 'x', 'x')")
  await runSampleWeek(db)
  server = startServer({ db, port: 0, clientDir: testClientDir(), reviewToken: TOKEN })
  shut = startServer({ db, port: 0, clientDir: testClientDir(), reviewToken: '' })
})

afterAll(() => {
  server.stop(true)
  shut.stop(true)
})

describe('Review export', () => {
  test('is not there at all while no review token is set', async () => {
    const res = await get(shut, '/api/review/export', TOKEN)
    expect(res.status).toBe(404)
  })

  test('refuses a missing or wrong token, whatever the Gallery says', async () => {
    db.run('UPDATE settings SET gallery_enabled = 1')
    expect((await get(server, '/api/review/export')).status).toBe(401)
    const wrong = await get(server, '/api/review/export', 'not-the-token')
    expect(wrong.status).toBe(401)
    expect(JSON.parse(wrong.text).error).toBe('The review token is missing or wrong.')
    db.run('UPDATE settings SET gallery_enabled = 0')
  })

  test('refuses dates it cannot read', async () => {
    expect((await get(server, '/api/review/export?from=last-week', TOKEN)).status).toBe(400)
  })

  test('gives the trading record for the range, never the login tables', async () => {
    const res = await get(server, '/api/review/export', TOKEN)
    expect(res.status).toBe(200)
    expect(res.text).not.toContain('secret-password-hash')
    expect(res.text).not.toContain('SECRETTOTPSEED')
    expect(res.text).not.toContain('secret-session-hash')
    const body = JSON.parse(res.text)
    expect(Object.keys(body)).not.toContain('trade_master')
    expect(Object.keys(body)).not.toContain('sessions')
    expect(body.from).toBe('2026-11-23')
    expect(body.to).toBe('2026-11-27')
    expect(body.settings.state).toBe('running')
    for (const key of ['models', 'traders', 'rule_sets', 'step_runs', 'runs', 'briefing_packs', 'decisions', 'orders', 'fills', 'snapshots', 'metrics', 'cash_ledger', 'news_per_day']) {
      expect(body[key].length).toBeGreaterThan(0)
    }
    expect(body.runs[0].prompt).toBeUndefined()
    expect(typeof body.runs[0].prompt_tail).toBe('string')
    expect(body.runs[0].prompt_tail).not.toContain('<briefing_pack')
  })

  test('narrows model calls and packs to the dates asked for', async () => {
    const body = JSON.parse((await get(server, '/api/review/export?from=2026-11-24&to=2026-11-24', TOKEN)).text)
    expect(body.briefing_packs.every((/** @type {any} */ p) => p.trading_date === '2026-11-24')).toBe(true)
    expect(body.runs.every((/** @type {any} */ r) => r.started_at.slice(0, 10) >= '2026-11-24')).toBe(true)
  })
})

describe('promptTail', () => {
  test('keeps what comes after the briefing pack', () => {
    const prompt = JSON.stringify({ system: 'rules', messages: [{ role: 'user', content: [{ type: 'text', text: '<briefing_pack kind="daily" date="2026-11-24">\n{}\n</briefing_pack>' }, { type: 'text', text: 'Your portfolio' }] }] })
    expect(promptTail(prompt)).toBe('Your portfolio')
  })

  test('keeps a whole message that has no pack, and copes with nothing', () => {
    expect(promptTail(JSON.stringify({ system: 's', messages: [{ role: 'user', content: 'Write the recap' }] }))).toBe('Write the recap')
    expect(promptTail(null)).toBeNull()
    expect(promptTail('not json')).toBeNull()
  })
})
