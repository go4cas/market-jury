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

/**
 * a × b ÷ c, rounded down, without losing precision on large amounts.
 * @param {number} a
 * @param {number} b
 * @param {number} c
 */
export const mulDiv = (a, b, c) => Number((BigInt(a) * BigInt(b)) / BigInt(c))

/**
 * The dollar value of a quantity at a price, to the nearest micro-dollar.
 * @param {number} quantityMicro micro-shares
 * @param {number} priceMicro micro-dollars per share
 */
export const valueOf = (quantityMicro, priceMicro) => Number((BigInt(quantityMicro) * BigInt(priceMicro) + 500_000n) / 1_000_000n)

/**
 * The share of `part` in `whole` as a percentage, to two decimal places.
 * @param {number} part
 * @param {number} whole
 */
export const share = (part, whole) => (whole ? Math.round((part / whole) * 10_000) / 100 : 0)

/** @param {number} micro */
export const usd = (micro) => `$${(micro / MICRO).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
