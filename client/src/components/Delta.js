import { html } from '@arrow-js/core'
import { signedPct } from '../utils/format.js'

// A change in value. Gains and losses always carry an arrow and a sign, never colour alone.
/**
 * @param {number | null | undefined} pct
 * @param {number} [digits]
 */
export function Delta(pct, digits = 1) {
  if (pct === null || pct === undefined) return html`<span class="font-mono text-fg-faint">—</span>`
  const rounded = Number(pct.toFixed(digits))
  if (rounded === 0) return html`<span class="font-mono text-fg-soft">${signedPct(pct, digits)}</span>`
  const up = rounded > 0
  return html`<span class="${`whitespace-nowrap font-mono ${up ? 'text-good' : 'text-bad'}`}"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${signedPct(pct, digits)}<span class="sr-only">${up ? ' up' : ' down'}</span></span>`
}
