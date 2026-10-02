import { createHash, randomBytes } from 'node:crypto'
import { verifyTotp } from './totp.js'
import { json, error, readJson } from './http.js'

/** @typedef {import('bun:sqlite').Database} Database */

export const SESSION_COOKIE = 'mj_session'
const SESSION_DAYS = 30
const MAX_FAILED_TRIES = 5
const LOCK_MINUTES = 15
const MAX_PASSWORD_LENGTH = 1024

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
        // Cheap shape checks first, so nonsense never reaches the slow password check.
        if (!password || password.length > MAX_PASSWORD_LENGTH || !/^\d{6}$/.test(code)) {
          return error(400, 'Enter your password and the 6-digit code from your authenticator app.')
        }

        const tm = /** @type {TradeMasterRow | null} */ (db.query('SELECT * FROM trade_master WHERE id = 1').get())
        if (!tm) return error(503, 'The Trade Master account has not been set up yet. Run `bun run trade-master:setup` on the server.')

        const nowMs = now()
        const at = new Date(nowMs).toISOString()
        if (tm.locked_until && Date.parse(tm.locked_until) > nowMs) {
          return error(429, `Too many wrong tries. Login is locked until ${tm.locked_until.slice(11, 16)} UTC.`)
        }

        const passwordOk = await Bun.password.verify(password, tm.password_hash)
        const step = verifyTotp(tm.totp_secret, code, nowMs)

        // Other logins may have run during the password check, so each decision
        // below reads and changes the current row in a single statement.
        // A code can only be used once, so a code seen over someone's shoulder is useless:
        // claiming its step works for one request only, and only while the login is not
        // locked and the password and authenticator have not been reset meanwhile.
        const claimed =
          passwordOk &&
          step !== null &&
          db.run(
            `UPDATE trade_master SET failed_attempts = 0, locked_until = NULL, last_totp_step = ?, updated_at = ?
             WHERE id = 1 AND last_totp_step < ? AND (locked_until IS NULL OR locked_until <= ?) AND password_hash = ? AND totp_secret = ?`,
            [step, at, step, at, tm.password_hash, tm.totp_secret],
          ).changes === 1

        if (!claimed) {
          // Count the wrong try on the current row; a lock already in place stays as it is.
          const row = /** @type {{ locked_until: string | null } | null} */ (
            db
              .query(
                `UPDATE trade_master SET
                   failed_attempts = CASE WHEN locked_until > ?1 THEN failed_attempts WHEN failed_attempts + 1 >= ?2 THEN 0 ELSE failed_attempts + 1 END,
                   locked_until = CASE WHEN locked_until > ?1 THEN locked_until WHEN failed_attempts + 1 >= ?2 THEN ?3 ELSE NULL END,
                   updated_at = ?1
                 WHERE id = 1 RETURNING locked_until`,
              )
              .get(at, MAX_FAILED_TRIES, new Date(nowMs + LOCK_MINUTES * 60_000).toISOString())
          )
          return row?.locked_until && row.locked_until > at
            ? error(429, `Too many wrong tries. Login is locked for ${LOCK_MINUTES} minutes.`)
            : error(401, 'That password or code is not right.')
        }

        const token = randomBytes(32).toString('base64url')
        const expires = new Date(nowMs + SESSION_DAYS * 86_400_000)
        db.transaction(() => {
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
