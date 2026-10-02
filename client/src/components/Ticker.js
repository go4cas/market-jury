import { html } from '@arrow-js/core'

// A ticker with its company name beside it ("AAPL Apple Inc."), so a reader new to
// trading knows what the letters stand for. The name is left out when unknown.
/**
 * @param {string} ticker
 * @param {string | null | undefined} name
 */
export const Ticker = (ticker, name) => html`<span class="font-mono font-semibold text-fg">${ticker}</span>${name ? html` <span class="font-sans font-normal text-fg-soft">${name}</span>` : ''}`
