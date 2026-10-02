// A stand-in for a provider's model in tests: CI never calls a paid API.
// Each call takes the next scripted reply (text, tool calls or an error), the
// way a recorded response would come back from the provider.
import { MockLanguageModelV4 } from 'ai/test'

/** @typedef {{ text: string } | { toolCalls: Array<{ name: string, input: object }> } | { error: string }} Reply */

/**
 * @param {Reply[]} replies
 * @param {{ input?: number, cached?: number, written?: number, output?: number }} [tokens] per call (written: tokens written to the prompt cache)
 */
export function mockModel(replies, { input = 1000, cached = 0, written = undefined, output = 200 } = {}) {
  let i = 0
  /** @type {any[]} */
  const calls = []
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options)
      const reply = replies[Math.min(i++, replies.length - 1)]
      if ('error' in reply) throw new Error(reply.error)
      const usage = {
        inputTokens: { total: input, noCache: input - cached - (written ?? 0), cacheRead: cached, cacheWrite: written },
        outputTokens: { total: output, text: output, reasoning: undefined },
      }
      if ('toolCalls' in reply) {
        return {
          content: reply.toolCalls.map((c, n) => ({ type: /** @type {const} */ ('tool-call'), toolCallId: `call-${i}-${n}`, toolName: c.name, input: JSON.stringify(c.input) })),
          finishReason: { unified: /** @type {const} */ ('tool-calls'), raw: undefined },
          usage,
          warnings: [],
        }
      }
      return { content: [{ type: /** @type {const} */ ('text'), text: reply.text }], finishReason: { unified: /** @type {const} */ ('stop'), raw: undefined }, usage, warnings: [] }
    },
  })
  return { model, calls }
}
