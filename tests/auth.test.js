import { beforeEach, describe, expect, test } from 'bun:test'
import { newTotpSecret, totpAt, currentStep } from '../server/totp.js'
import { testServer } from './helpers.js'

const PASSWORD = 'correct horse battery staple'

/** @type {ReturnType<typeof testServer>} */
let t
let clock = 1_790_000_000_000
let secret = ''

beforeEach(async () => {
  clock = 1_790_000_000_000
  t = testServer({ now: () => clock })
  secret = newTotpSecret()
  t.db.run('INSERT INTO trade_master (id, password_hash, totp_secret, updated_at) VALUES (1, ?, ?, ?)', [
    await Bun.password.hash(PASSWORD),
    secret,
    new Date().toISOString(),
  ])
})

const code = () => totpAt(secret, currentStep(clock))

/** @param {Record<string, unknown>} body */
const login = (body) =>
  t.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** @param {Response} res */
const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0]

describe('Trade Master login', () => {
  test('a visitor is not the Trade Master and the Gallery starts closed', async () => {
    expect(await (await t.request('/api/session')).json()).toEqual({ tradeMaster: false, galleryEnabled: false })
  })

  test('the right password and code start a session with a locked-down cookie', async () => {
    const res = await login({ password: PASSWORD, code: code() })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('mj_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie.toLowerCase()).toContain('samesite=strict')

    const session = await t.request('/api/session', { headers: { Cookie: cookieOf(res) } })
    expect(await session.json()).toEqual({ tradeMaster: true, galleryEnabled: false })
  })

  test('the session token is stored only as a hash', async () => {
    const res = await login({ password: PASSWORD, code: code() })
    const token = cookieOf(res).split('=')[1]
    const stored = t.db.query('SELECT token_hash FROM sessions').values().flat()
    expect(stored).toHaveLength(1)
    expect(stored[0]).not.toBe(token)
  })

  test('a wrong password or code is refused', async () => {
    expect((await login({ password: 'wrong password!', code: code() })).status).toBe(401)
    expect((await login({ password: PASSWORD, code: '000000' === code() ? '111111' : '000000' })).status).toBe(401)
  })

  test('a code cannot be used twice', async () => {
    const used = code()
    expect((await login({ password: PASSWORD, code: used })).status).toBe(200)
    expect((await login({ password: PASSWORD, code: used })).status).toBe(401)
  })

  test('five wrong tries lock the login for 15 minutes, even with the right details', async () => {
    for (let i = 0; i < 4; i++) expect((await login({ password: 'nope nope nope', code: code() })).status).toBe(401)
    expect((await login({ password: 'nope nope nope', code: code() })).status).toBe(429)

    clock += 14 * 60_000
    expect((await login({ password: PASSWORD, code: code() })).status).toBe(429)

    clock += 2 * 60_000
    expect((await login({ password: PASSWORD, code: code() })).status).toBe(200)
  })

  test('a non-JSON or incomplete body is refused', async () => {
    const form = await t.request('/api/auth/login', { method: 'POST', body: `password=${PASSWORD}` })
    expect(form.status).toBe(400)
    expect((await login({ password: PASSWORD })).status).toBe(400)
  })

  test('logging out ends the session', async () => {
    const cookie = cookieOf(await login({ password: PASSWORD, code: code() }))
    await t.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } })
    const session = await t.request('/api/session', { headers: { Cookie: cookie } })
    expect(await session.json()).toEqual({ tradeMaster: false, galleryEnabled: false })
  })

  test('the same password and code sent at once start exactly one session', async () => {
    const used = code()
    const results = await Promise.all(Array.from({ length: 8 }, () => login({ password: PASSWORD, code: used })))
    expect(results.map((r) => r.status).filter((s) => s === 200)).toHaveLength(1)
    // The others are reused codes, which count as wrong tries (enough of them lock the login).
    expect(results.filter((r) => r.status !== 200).every((r) => r.status === 401 || r.status === 429)).toBe(true)
    expect(t.db.query('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 })
  })

  test('ten wrong tries sent at once all count, so login ends locked', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => login({ password: 'nope nope nope', code: code() })))
    expect(results.some((r) => r.status === 429)).toBe(true)
    const tm = /** @type {{ locked_until: string | null }} */ (t.db.query('SELECT locked_until FROM trade_master').get())
    expect(Date.parse(tm.locked_until ?? '')).toBeGreaterThan(clock)
    expect((await login({ password: PASSWORD, code: code() })).status).toBe(429)
  })

  test('a code that is not 6 digits or a very long password is refused before checking', async () => {
    expect((await login({ password: PASSWORD, code: '12345' })).status).toBe(400)
    expect((await login({ password: PASSWORD, code: '12a456' })).status).toBe(400)
    expect((await login({ password: 'x'.repeat(1025), code: code() })).status).toBe(400)
    expect(t.db.query('SELECT failed_attempts FROM trade_master').get()).toEqual({ failed_attempts: 0 })
    expect((await login({ password: PASSWORD, code: code().replace(/(\d{3})/, '$1 ') })).status).toBe(200)
  })

  test('a body bigger than any form needs is refused without being read', async () => {
    const res = await login({ password: 'x'.repeat(100_000), code: code() })
    expect(res.status).toBe(413)
  })

  test('says so when no Trade Master has been set up', async () => {
    t.db.run('DELETE FROM trade_master')
    expect((await login({ password: PASSWORD, code: '123456' })).status).toBe(503)
  })
})
