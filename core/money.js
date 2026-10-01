// Money is stored as integer micro-dollars ($1 = 1,000,000) and quantities as
// integer micro-shares, so sums never drift. Convert only at the edges.

export const MICRO = 1_000_000

/** @param {number} dollars */
export const toMicro = (dollars) => Math.round(dollars * MICRO)

/** @param {number} micro */
export const fromMicro = (micro) => micro / MICRO

/**
 * Percent change from `before` to `after`, to one decimal place.
 * @param {number} after
 * @param {number | null | undefined} before
 * @returns {number | null}
 */
export function percentChange(after, before) {
  if (!before) return null
  return Math.round(((after - before) / before) * 1000) / 10
}
