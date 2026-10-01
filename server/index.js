import { openDb, migrate } from '../db/index.js'
import { config } from './config.js'
import { startServer } from './app.js'

const db = openDb(config.dbPath)
const applied = migrate(db)
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`)

const server = startServer({ db, port: config.port, clientDir: config.clientDir })
console.log(`Market Jury is listening on ${server.url}`)
