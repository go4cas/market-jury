import { html } from '@arrow-js/core'
import { colourOf, displayName, markOf } from '../utils/traders.js'

// A Trader's square mark in its own colour ("CL" for Claude), with its name.
/**
 * @param {import('../utils/traders.js').TraderLike} t
 * @param {{ size?: 'sm' | 'md' | 'lg' }} [options]
 */
export function TraderMark(t, { size = 'md' } = {}) {
  const box = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-11 w-11 text-sm' }[size]
  const style = t.kind === 'benchmark'
    ? `border: 2px dashed ${colourOf(t)}; color: ${colourOf(t)}`
    : `background: ${colourOf(t)}; color: var(--color-surface)`
  return html`<span aria-hidden="true" class="${`inline-flex shrink-0 items-center justify-center rounded-control font-mono font-bold ${box}`}" style="${style}">${markOf(t)}</span>`
}

/**
 * Mark plus "Claude · Daily".
 * @param {import('../utils/traders.js').TraderLike} t
 * @param {{ size?: 'sm' | 'md' | 'lg' }} [options]
 */
export function TraderName(t, options = {}) {
  return html`<span class="inline-flex items-center gap-2">${TraderMark(t, options)}<span class="font-semibold text-fg">${displayName(t.name)}</span></span>`
}

/**
 * A short line swatch for chart legends: solid for a Trader, dashed for The Index.
 * @param {import('../utils/traders.js').TraderLike} t
 */
export function Swatch(t) {
  return t.kind === 'benchmark'
    ? html`<span aria-hidden="true" class="inline-block w-4" style="${`border-top: 2px dashed ${colourOf(t)}`}"></span>`
    : html`<span aria-hidden="true" class="inline-block h-[3px] w-4" style="${`background: ${colourOf(t)}`}"></span>`
}
