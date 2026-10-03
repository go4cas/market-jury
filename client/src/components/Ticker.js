import { html } from '@arrow-js/core'

// A ticker with its company name beside it ("AAPL Apple Inc."), so a reader new to
// trading knows what the letters stand for. The name is left out when unknown.
/**
 * @param {string} ticker
 * @param {string | null | undefined} name
 * @param {{ stacked?: boolean }} [options] stacked: on a phone the name wraps on its own line under the ticker
 */
export const Ticker = (ticker, name, { stacked = false } = {}) => html`<span class="font-mono font-semibold text-fg">${ticker}</span>${name ? html` <span class="${`font-sans font-normal text-fg-soft${stacked ? ' block text-xs sm:inline sm:text-sm' : ''}`}">${name}</span>` : ''}`
