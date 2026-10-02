// One model call, as the PRD asks: every attempt is a stored run with its exact
// prompt, raw response, tokens and cost. A failed call is retried up to 3
// times; an answer that doesn't match the schema gets one repair attempt
// (counted as one of those retries). The answer is parsed, never executed.
import { APICallError, generateText, isStepCount, NoObjectGeneratedError, Output } from 'ai'
import { costOf, reasoningFor } from './models.js'

/** @typedef {import('bun:sqlite').Database} Database */
/** @typedef {import('ai').ModelMessage} ModelMessage */

export const MAX_ATTEMPTS = 4

/** The longest a provider may ask us to wait before the next attempt. */
const MAX_WAIT_MS = 60_000
/** One attempt, lookups included, may take this long before it is stopped and counted as failed. */
export const ATTEMPT_TIMEOUT_MS = 5 * 60_000

/**
 * How long to wait before the next attempt: 2, 4, 8 seconds for most failures.
 * A busy or rate-limited provider (HTTP 429 or 5xx, such as Gemini's "high
 * demand") gets 15, 30, 60 seconds, or longer when it says when to come back
 * (Google: "Please retry in 35.6s"), up to a minute.
 * @param {unknown} e
 * @param {number} attempt the attempt that just failed, from 1
 * @returns {number} milliseconds
 */
export function retryDelay(e, attempt) {
  const backoff = 2 ** attempt * 1000
  if (!APICallError.isInstance(e) || !(e.statusCode === 429 || (e.statusCode ?? 0) >= 500)) return backoff
  const patient = Math.min(MAX_WAIT_MS, 15_000 * 2 ** (attempt - 1))
  const header = Number(e.responseHeaders?.['retry-after'])
  const said = Number(/retry in ([\d.]+)\s*s/i.exec(e.message)?.[1])
  const seconds = Number.isFinite(header) && header > 0 ? header : Number.isFinite(said) && said > 0 ? said : 0
  return Math.max(patient, Math.min(MAX_WAIT_MS, Math.ceil(seconds) * 1000 + 1000))
}

/**
 * @template T
 * @typedef {object} CallOptions
 * @property {Database} db
 * @property {import('./models.js').ModelRow} model
 * @property {import('ai').LanguageModel} languageModel
 * @property {'trader' | 'columnist'} kind
 * @property {number | null} [traderId]
 * @property {number | null} [packId]
 * @property {boolean} [dryRun]
 * @property {string} system
 * @property {ModelMessage[]} messages
 * @property {import('zod').ZodType<T>} schema
 * @property {Record<string, import('ai').Tool>} [tools]
 * @property {number} [maxSteps] model calls allowed, counting tool rounds and the final answer
 * @property {() => Date} now
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {typeof generateText} [generate] replaced in tests
 */

/**
 * @template T
 * @param {CallOptions<T>} o
 * @returns {Promise<{ ok: true, output: T, runId: number, costMicro: number } | { ok: false, error: string, runId: number, costMicro: number }>}
 */
export async function callModel(o) {
  const { db, model, kind, traderId = null, packId = null, dryRun = false, now, sleep = (ms) => Bun.sleep(ms), generate = generateText } = o
  let messages = o.messages
  let repaired = false
  let costMicro = 0
  let runId = 0
  let error = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    runId = /** @type {{ id: number }} */ (
      db.query(`INSERT INTO runs (kind, trader_id, model_id, pack_id, dry_run, status, attempt, prompt, started_at)
                VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?) RETURNING id`)
        .get(kind, traderId, model.id, packId, dryRun ? 1 : 0, attempt, JSON.stringify({ system: o.system, messages }), now().toISOString())
    ).id
    // What each finished round cost and did, kept even when a later round fails.
    /** @type {import('ai').LanguageModelUsage[]} */
    const used = []
    /** @type {unknown[]} */
    const steps = []
    try {
      const result = await generate({
        model: o.languageModel,
        system: o.system,
        messages,
        output: Output.object({ schema: o.schema }),
        tools: o.tools,
        stopWhen: isStepCount(o.maxSteps ?? 1),
        reasoning: reasoningFor(model),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        onStepFinish: (s) => {
          used.push(s.usage)
          steps.push({ text: s.text, toolCalls: s.toolCalls.map((c) => ({ tool: c.toolName, input: c.input })), toolResults: s.toolResults.map((r) => ({ tool: r.toolName, output: r.output })), usage: s.usage })
        },
      })
      const output = /** @type {T} */ (result.output)
      const toolCalls = result.steps.flatMap((s) => s.toolCalls.map((c) => ({ tool: c.toolName, input: c.input })))
      costMicro += finish(db, runId, model, result.totalUsage, { status: 'succeeded', response: JSON.stringify({ text: result.text, toolCalls, steps }), now })
      return { ok: true, output, runId, costMicro }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      if (NoObjectGeneratedError.isInstance(e)) {
        costMicro += finish(db, runId, model, e.usage, { status: 'failed', response: e.text ?? null, error: `The answer didn't match the expected format: ${error}`, now })
        if (!repaired) {
          // One repair attempt: show the model its answer and what was wrong with it.
          repaired = true
          messages = [...o.messages,
            { role: 'assistant', content: e.text ?? '' },
            { role: 'user', content: `That answer didn't match the required format (${error}). Reply again with only the corrected answer in the required format.` }]
          continue
        }
      } else {
        costMicro += finish(db, runId, model, sumUsage(used), { status: 'failed', response: steps.length ? JSON.stringify({ steps }) : null, error, now })
      }
      if (attempt < MAX_ATTEMPTS) await sleep(retryDelay(e, attempt))
    }
  }
  return { ok: false, error, runId, costMicro }
}

/**
 * @param {Database} db
 * @param {number} runId
 * @param {import('./models.js').ModelRow} model
 * @param {import('ai').LanguageModelUsage | undefined} usage
 * @param {{ status: 'succeeded' | 'failed', response: string | null, error?: string | null, now: () => Date }} r
 * @returns {number} the call's cost
 */
function finish(db, runId, model, usage, { status, response, error = null, now }) {
  const tokens = { input: usage?.inputTokens ?? 0, cached: usage?.inputTokenDetails?.cacheReadTokens ?? 0, written: usage?.inputTokenDetails?.cacheWriteTokens ?? 0, output: usage?.outputTokens ?? 0 }
  const cost = costOf(model, tokens)
  db.run(`UPDATE runs SET status = ?, response = ?, error = ?, tokens_in = ?, tokens_cached = ?, tokens_out = ?, cost_micro = ?, finished_at = ? WHERE id = ?`,
    [status, response, error, tokens.input, tokens.cached, tokens.output, cost, now().toISOString(), runId])
  return cost
}

/**
 * The tokens of the rounds that finished before a failure.
 * @param {import('ai').LanguageModelUsage[]} used
 * @returns {import('ai').LanguageModelUsage | undefined}
 */
function sumUsage(used) {
  if (!used.length) return undefined
  const add = (/** @type {(u: import('ai').LanguageModelUsage) => number | undefined} */ f) => used.reduce((n, u) => n + (f(u) ?? 0), 0)
  return /** @type {import('ai').LanguageModelUsage} */ (/** @type {unknown} */ ({
    inputTokens: add((u) => u.inputTokens),
    outputTokens: add((u) => u.outputTokens),
    inputTokenDetails: { cacheReadTokens: add((u) => u.inputTokenDetails?.cacheReadTokens), cacheWriteTokens: add((u) => u.inputTokenDetails?.cacheWriteTokens) },
  }))
}
