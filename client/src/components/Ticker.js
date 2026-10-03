import { html } from '@arrow-js/core'

// A ticker with its company name beside it ("AAPL Apple Inc."), so a reader new to
// trading knows what the letters stand for. The name is left out when unknown.
/**
 * @param {string} ticker
 * @param {string | null | undefined} name
 * @param {{ stacked?: boolean }} [options] stacked: on a phone the name sits under the ticker, cut short with an ellipsis
 */
export const Ticker = (ticker, name, { stacked = false } = {}) => html`<span class="font-mono font-semibold text-fg">${ticker}</span>${name ? html` <span class="${`font-sans font-normal text-fg-soft${stacked ? ' block max-w-[22ch] truncate text-xs sm:inline sm:max-w-none sm:whitespace-normal sm:text-sm' : ''}`}">${name}</span>` : ''}`
