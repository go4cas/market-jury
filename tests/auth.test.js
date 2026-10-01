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

  test('says so when no Trade Master has been set up', async () => {
    t.db.run('DELETE FROM trade_master')
    expect((await login({ password: PASSWORD, code: '123456' })).status).toBe(503)
  })
})
