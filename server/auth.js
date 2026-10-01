import { createHash, randomBytes } from 'node:crypto'
import { verifyTotp } from './totp.js'
import { json, error, readJson } from './http.js'

/** @typedef {import('bun:sqlite').Database} Database */

export const SESSION_COOKIE = 'mj_session'
const SESSION_DAYS = 30
const MAX_FAILED_TRIES = 5
const LOCK_MINUTES = 15

/** @param {string} token */
const hashToken = (token) => createHash('sha256').update(token).digest('hex')

/**
 * @typedef {object} TradeMasterRow
 * @property {string} password_hash
 * @property {string} totp_secret
 * @property {number} last_totp_step
 * @property {number} failed_attempts
 * @property {string | null} locked_until
 */

/**
 * Is this request from the logged-in Trade Master?
 * @param {Database} db
 * @param {Request} req
 */
export function isTradeMaster(db, req) {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return false
  const row = db
    .query('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(hashToken(token), new Date().toISOString())
  return Boolean(row)
}

/**
 * @param {Request} req
 * @param {string} name
 */
function readCookie(req, name) {
  return new Bun.CookieMap(req.headers.get('cookie') ?? '').get(name)
}

/**
 * @param {string} value
 * @param {number} maxAgeSeconds
 */
function sessionCookie(value, maxAgeSeconds) {
  return new Bun.Cookie(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: maxAgeSeconds,
  }).serialize()
}

/**
 * Routes for logging the Trade Master in and out.
 * @param {Database} db
 * @param {{ now?: () => number }} [options] `now` lets tests move the clock
 */
export function authRoutes(db, { now = Date.now } = {}) {
  return {
    '/api/auth/login': {
      /** @param {Request} req */
      POST: async (req) => {
        const body = await readJson(req)
        const password = typeof body?.password === 'string' ? body.password : ''
        const code = typeof body?.code === 'string' ? body.code.replace(/\s/g, '') : ''
        if (!password || !code) return error(400, 'Enter your password and the 6-digit code from your authenticator app.')

        const tm = /** @type {TradeMasterRow | null} */ (db.query('SELECT * FROM trade_master WHERE id = 1').get())
        if (!tm) return error(503, 'The Trade Master account has not been set up yet. Run `bun run trade-master:setup` on the server.')

        const nowMs = now()
        if (tm.locked_until && Date.parse(tm.locked_until) > nowMs) {
          return error(429, `Too many wrong tries. Login is locked until ${tm.locked_until.slice(11, 16)} UTC.`)
        }

        const passwordOk = await Bun.password.verify(password, tm.password_hash)
        const step = verifyTotp(tm.totp_secret, code, nowMs)
        // A code can only be used once, so a code seen over someone's shoulder is useless.
        const codeOk = step !== null && step > tm.last_totp_step

        if (!passwordOk || !codeOk) {
          const failed = tm.failed_attempts + 1
          const locked = failed >= MAX_FAILED_TRIES
          db.run('UPDATE trade_master SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = 1', [
            locked ? 0 : failed,
            locked ? new Date(nowMs + LOCK_MINUTES * 60_000).toISOString() : null,
            new Date(nowMs).toISOString(),
          ])
          return locked
            ? error(429, `Too many wrong tries. Login is locked for ${LOCK_MINUTES} minutes.`)
            : error(401, 'That password or code is not right.')
        }

        const token = randomBytes(32).toString('base64url')
        const expires = new Date(nowMs + SESSION_DAYS * 86_400_000)
        db.transaction(() => {
          db.run('UPDATE trade_master SET failed_attempts = 0, locked_until = NULL, last_totp_step = ?, updated_at = ? WHERE id = 1', [
            step,
            new Date(nowMs).toISOString(),
          ])
          db.run('DELETE FROM sessions WHERE expires_at <= ?', [new Date(nowMs).toISOString()])
          db.run('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)', [
            hashToken(token),
            new Date(nowMs).toISOString(),
            expires.toISOString(),
          ])
        })()
        return json({ tradeMaster: true }, 200, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86_400) })
      },
    },

    '/api/auth/logout': {
      /** @param {Request} req */
      POST: (req) => {
        const token = readCookie(req, SESSION_COOKIE)
        if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)])
        return json({ tradeMaster: false }, 200, { 'Set-Cookie': sessionCookie('', 0) })
      },
    },
  }
}
