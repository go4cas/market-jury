// Send a stored Trader run's exact prompt to its model again and print what
// comes back, to find out why an answer went wrong. Nothing is stored.
//   bun run replay-run 249              # the same tools as the Trader had
//   bun run replay-run 249 --no-search  # without its web search tool
// It costs about what the original run did (see Costs).
import { Database } from 'bun:sqlite'
import { generateText, isStepCount, Output } from 'ai'
import { config } from '../server/config.js'
import { closeInstant } from '../core/calendar.js'
import { trackOf } from '../core/tracks.js'
import { languageModel, modelRow, reasoningFor } from '../agents/models.js'
import { searchFor } from '../agents/search.js'
import { lookupTools, MAX_LOOKUPS } from '../agents/tools.js'
import { answerSchema } from '../agents/trader.js'

const [id, flag] = process.argv.slice(2)
if (!/^\d+$/.test(id ?? '') || (flag && flag !== '--no-search')) {
  console.error('Give a run number, and optionally --no-search: bun run replay-run 249 --no-search')
  process.exit(1)
}

const db = new Database(config.dbPath, { readonly: true })
const run = /** @type {{ trader_id: number | null, model_id: number, kind: string, prompt: string, trading_date: string | null } | null} */ (
  db.query('SELECT r.trader_id, r.model_id, r.kind, r.prompt, p.trading_date FROM runs r LEFT JOIN briefing_packs p ON p.id = r.pack_id WHERE r.id = ?').get(Number(id)))
if (!run || run.kind !== 'trader' || !run.trader_id || !run.trading_date) {
  console.error(`Run ${id} isn't a Trader's run with a briefing pack.`)
  process.exit(1)
}

const model = modelRow(db, run.model_id)
const search = flag ? { tools: {}, maxSearches: 0 } : searchFor(trackOf(db, run.trader_id), model.provider)
const tools = { ...lookupTools(db, run.trading_date, /** @type {Date} */ (closeInstant(db, run.trading_date))), ...search.tools }
const { system, messages } = JSON.parse(run.prompt)
console.log(`Run ${id}: ${model.provider} ${model.model_version}, tools: ${Object.keys(tools).join(', ')}`)

try {
  const result = await generateText({
    model: languageModel(model), system, messages, tools,
    output: Output.object({ schema: answerSchema }),
    stopWhen: isStepCount(MAX_LOOKUPS + search.maxSearches + 2),
    reasoning: reasoningFor(model),
    maxRetries: 1,
  })
  result.steps.forEach((s, i) => console.log(`step ${i + 1}: ${s.finishReason}; tools ${s.toolCalls.map((c) => c.toolName).join(', ') || 'none'}; ${s.usage.outputTokens} tokens out\n${s.text.slice(0, 2_000)}`))
  console.log('answer:', JSON.stringify(result.output, null, 2))
} catch (e) {
  console.log('failed:', e instanceof Error ? e.message : e)
  const text = /** @type {any} */ (e)?.text
  if (text) console.log('its text:', text.slice(0, 2_000))
}
