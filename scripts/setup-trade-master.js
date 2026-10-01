// Create or reset the Trade Master login: a password plus an authenticator-app code.
// Run on the server: bun run trade-master:setup
// Resetting signs out every existing session.
import { openDb, migrate } from '../db/index.js'
import { config } from '../server/config.js'
import { newTotpSecret, otpauthUri } from '../server/totp.js'

const MIN_LENGTH = 12

const password = process.env.TRADE_MASTER_PASSWORD ?? prompt(`New Trade Master password (at least ${MIN_LENGTH} characters):`) ?? ''
if (password.length < MIN_LENGTH) {
  console.error(`The password needs at least ${MIN_LENGTH} characters. Nothing was changed.`)
  process.exit(1)
}

const db = openDb(config.dbPath)
migrate(db)

const secret = newTotpSecret()
const hash = await Bun.password.hash(password, { algorithm: 'argon2id' })
const now = new Date().toISOString()
db.transaction(() => {
  db.run(
    `INSERT INTO trade_master (id, password_hash, totp_secret, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET password_hash = excluded.password_hash, totp_secret = excluded.totp_secret,
       last_totp_step = 0, failed_attempts = 0, locked_until = NULL, updated_at = excluded.updated_at`,
    [hash, secret, now],
  )
  db.run('DELETE FROM sessions')
})()
db.close()

console.log(`
Trade Master login saved.

Add Market Jury to your authenticator app (Google Authenticator, 1Password, Authy...):
  Setup key: ${secret}
  Or open this link on your phone / turn it into a QR code:
  ${otpauthUri(secret)}

Keep the setup key somewhere safe: it is the only way to add the login to a new phone.
`)
