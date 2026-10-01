import { openDb, migrate } from '../db/index.js'
import { config } from './config.js'
import { startServer } from './app.js'
import { createAlpaca } from '../market/alpaca.js'
import { startScheduler } from '../jobs/schedule.js'

const db = openDb(config.dbPath)
const applied = migrate(db)
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`)

const steps = { db, now: () => new Date(), alpaca: createAlpaca(config.alpaca) }
const server = startServer({ db, port: config.port, clientDir: config.clientDir, steps })
startScheduler(steps)
console.log(`Market Jury is listening on ${server.url}`)
