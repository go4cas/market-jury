// Run the Floor Runner by hand for one trading day (default: today in New York).
//   bun run floor-runner            # today
//   bun run floor-runner 2026-11-24 # a given day
// The scheduler runs the same step every evening once it exists.
import { openDb, migrate } from '../db/index.js'
import { config } from '../server/config.js'
import { createAlpaca } from '../market/alpaca.js'
import { marketDate } from '../core/calendar.js'
import { runFloorRunner } from '../jobs/floorRunner.js'

const date = process.argv[2] ?? marketDate(new Date())
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`"${date}" is not a date. Use YYYY-MM-DD.`)
  process.exit(1)
}

const db = openDb(config.dbPath)
migrate(db)
try {
  const result = await runFloorRunner({ db, alpaca: createAlpaca(config.alpaca), date })
  if (result.skipped) console.log(result.skipped)
  else console.log(`Briefing pack for ${date} is ready (daily #${result.daily}${result.weekly ? `, weekly #${result.weekly}` : ''}).`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  db.close()
}
