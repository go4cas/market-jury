// How a Trader looks everywhere: its fixed colour, its two-letter mark, and
// its name split into model and cadence ("Claude · Daily").

/**
 * @typedef {object} TraderLike
 * @property {string} name
 * @property {string} [kind] 'ai' or 'benchmark'
 * @property {number | null} [colourSlot]
 */

/**
 * The CSS colour of a Trader's line, mark and swatch.
 * @param {TraderLike} t
 */
export const colourOf = (t) => (t.kind === 'benchmark' ? 'var(--color-index)' : `var(--color-trader-${t.colourSlot ?? 5})`)

/** @param {TraderLike} t */
export function markOf(t) {
  if (t.kind === 'benchmark') return 'SPY'
  const model = modelName(t.name)
  const known = /** @type {Record<string, string>} */ ({ Claude: 'CL', GPT: 'GP', Gemini: 'GE', DeepSeek: 'DS' })
  return known[model] ?? model.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
}

/**
 * "Claude" from "Claude daily".
 * @param {string} name
 */
export const modelName = (name) => name.replace(/\s+(daily|weekly)$/i, '')

/**
 * "Claude · Daily" from "Claude daily"; The Index stays as it is.
 * @param {string} name
 */
export function displayName(name) {
  const m = name.match(/^(.*)\s+(daily|weekly)$/i)
  return m ? `${m[1]} · ${m[2][0].toUpperCase()}${m[2].slice(1)}` : name
}
