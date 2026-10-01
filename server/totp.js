import { createHmac, randomBytes } from 'node:crypto'

// Time-based one-time codes (RFC 6238) for the authenticator app on the
// Trade Master login: SHA-1, 6 digits, 30-second steps, as every app expects.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30

/** @param {Uint8Array} bytes */
export function base32Encode(bytes) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** @param {string} text */
export function base32Decode(text) {
  const clean = text.toUpperCase().replace(/[\s=]/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new random secret (160 bits), base32-encoded for the authenticator app. */
export function newTotpSecret() {
  return base32Encode(randomBytes(20))
}

/**
 * The code for one 30-second step.
 * @param {string} secret base32
 * @param {number} step
 */
export function totpAt(secret, step) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 15
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 1_000_000).padStart(6, '0')
}

/** @param {number} [nowMs] */
export function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS)
}

/**
 * Check a typed code against the current step and one step either side
 * (phone clocks drift). Returns the matching step, or null.
 * @param {string} secret
 * @param {string} code
 * @param {number} [nowMs]
 * @returns {number | null}
 */
export function verifyTotp(secret, code, nowMs = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null
  const now = currentStep(nowMs)
  for (const step of [now - 1, now, now + 1]) {
    if (totpAt(secret, step) === code) return step
  }
  return null
}

/**
 * The link an authenticator app reads (usually shown as a QR code).
 * @param {string} secret
 */
export function otpauthUri(secret) {
  const label = encodeURIComponent('Market Jury:Trade Master')
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('Market Jury')}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`
}
