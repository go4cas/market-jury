import { openDb, migrate } from './index.js'
import { config } from '../server/config.js'

const db = openDb(config.dbPath)
const applied = migrate(db)
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.')
db.close()
