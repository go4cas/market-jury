// Check every model in the line-up answers with the keys in the environment:
//   bun run models:check
// One tiny request per model (a fraction of a cent each). Run it on the server
// after adding the API keys, before starting the experiment.
import { generateText } from 'ai'
import { languageModel, LINE_UP, reasoningFor } from '../agents/models.js'

const models = [...LINE_UP.traders, LINE_UP.columnist.daily, LINE_UP.columnist.weekly]
let failed = 0
for (const m of models) {
  const row = { id: 0, ...m, input_micro_per_mtok: 0, cached_input_micro_per_mtok: 0, output_micro_per_mtok: 0 }
  try {
    const { text } = await generateText({ model: languageModel(row), prompt: 'Reply with the single word: ready', reasoning: reasoningFor(row), maxRetries: 1 })
    console.log(`ok    ${m.provider} ${m.model_version}: ${text.trim().slice(0, 40)}`)
  } catch (e) {
    failed++
    console.log(`FAIL  ${m.provider} ${m.model_version}: ${e instanceof Error ? e.message : e}`)
  }
}
console.log(failed ? `${failed} of ${models.length} models did not answer. Fix the key or the model version before starting.` : 'Every model answered.')
process.exit(failed ? 1 : 0)
