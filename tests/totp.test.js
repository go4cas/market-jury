import { describe, expect, test } from 'bun:test'
import { base32Decode, base32Encode, newTotpSecret, totpAt, verifyTotp, currentStep } from '../server/totp.js'

// RFC 6238 appendix B test secret ("12345678901234567890"), SHA-1, truncated to 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'))

describe('base32', () => {
  test('round-trips random bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20))
    expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes])
  })

  test('matches the RFC 4648 example', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
  })
})

describe('totp', () => {
  test.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches RFC 6238 at T=%i', (seconds, code) => {
    expect(totpAt(RFC_SECRET, Math.floor(seconds / 30))).toBe(code)
  })

  test('accepts the previous, current and next step only', () => {
    const secret = newTotpSecret()
    const now = 1_790_000_000_000
    const step = currentStep(now)
    expect(verifyTotp(secret, totpAt(secret, step), now)).toBe(step)
    expect(verifyTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1)
    expect(verifyTotp(secret, totpAt(secret, step + 1), now)).toBe(step + 1)
    expect(verifyTotp(secret, totpAt(secret, step - 2), now)).toBeNull()
  })

  test('rejects anything that is not six digits', () => {
    expect(verifyTotp(newTotpSecret(), '12345')).toBeNull()
    expect(verifyTotp(newTotpSecret(), 'abcdef')).toBeNull()
  })
})
