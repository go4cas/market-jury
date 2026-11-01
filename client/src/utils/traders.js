// How a Trader looks everywhere: its fixed colour, its two-letter mark, and
// its name split into model and track ("Claude · Daily", "Claude · Weekly research").

/**
 * @typedef {object} TraderLike
 * @property {string} name
 * @property {string} [kind] 'ai' or 'benchmark'
 * @property {number | null} [colourSlot]
 * @property {string} [colour] a CSS colour for a line that is not one Trader (a Track's average in Compare)
 * @property {'solid' | 'dotted' | 'dashdot'} [style] a chart line's style (see lineStyleOf)
 * @property {boolean} [dotted] same as style 'dotted'
 */

/**
 * The CSS colour of a Trader's line, mark and swatch.
 * @param {TraderLike} t
 */
export const colourOf = (t) => (t.kind === 'benchmark' ? 'var(--color-index)' : TRADER_COLOURS[(t.colourSlot ?? 5) - 1] ?? TRADER_COLOURS[4])

// Spelled out in full: Tailwind only emits the theme colours it finds written
// somewhere, so a name built at run time ("--color-trader-" + n) would leave
// Daylight without its Trader colours.
const TRADER_COLOURS = [
  'var(--color-trader-1)', 'var(--color-trader-2)', 'var(--color-trader-3)', 'var(--color-trader-4)',
  'var(--color-trader-5)', 'var(--color-trader-6)', 'var(--color-trader-7)', 'var(--color-trader-8)',
  'var(--color-trader-9)', 'var(--color-trader-10)', 'var(--color-trader-11)', 'var(--color-trader-12)',
]

/** @param {TraderLike} t */
export function markOf(t) {
  if (t.kind === 'benchmark') return 'SPY'
  const model = modelName(t.name)
  const known = /** @type {Record<string, string>} */ ({ Claude: 'CL', GPT: 'GP', Gemini: 'GE', DeepSeek: 'DS' })
  return known[model] ?? model.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
}

/**
 * "Claude" from "Claude daily" or "Claude weekly research".
 * @param {string} name
 */
export const modelName = (name) => name.replace(/\s+(daily|weekly)(\s.*)?$/i, '')

/**
 * "Claude · Daily" from "Claude daily", "Claude · Weekly research" from
 * "Claude weekly research"; The Index stays as it is.
 * @param {string} name
 */
export function displayName(name) {
  const m = name.match(/^(.*?)\s+((?:daily|weekly)(?:\s.*)?)$/i)
  return m ? `${m[1]} · ${m[2][0].toUpperCase()}${m[2].slice(1)}` : name
}

/**
 * How a Track's line is drawn where several Tracks of one model meet (Compare):
 * the first solid, the second dotted, later ones dash-dot. The Index alone is dashed.
 * @param {number} position the Track's place in the list, from 0
 * @returns {'solid' | 'dotted' | 'dashdot'}
 */
export const lineStyleOf = (position) => (position <= 0 ? 'solid' : position === 1 ? 'dotted' : 'dashdot')
