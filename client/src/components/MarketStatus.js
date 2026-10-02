import { html } from '@arrow-js/core'
import { formatClock, NY_TIME_ZONE } from '../utils/time.js'

const LOOK = /** @type {Record<string, { box: string, dot: string, word: string }>} */ ({
  open: { box: 'border-good bg-good-wash text-good', dot: 'bg-current', word: 'Market open' },
  soon: { box: 'border-bad bg-bad-wash text-bad', dot: '', word: 'Market closed' },
  closed: { box: 'border-bad bg-bad-wash text-bad', dot: '', word: 'Market closed' },
  holiday: { box: 'border-bad bg-bad-wash text-bad', dot: '', word: 'Market closed' },
})

/**
 * "Mon 09:30 NY".
 * @param {Date} at
 */
const nyWhen = (at) => `${new Intl.DateTimeFormat('en-GB', { timeZone: NY_TIME_ZONE, weekday: 'short' }).format(at)} ${formatClock(at, NY_TIME_ZONE)} NY`

/**
 * The muted half of the pill: when the state changes next.
 * @param {string} market
 * @param {string | null} changesAt
 * @param {number} now
 */
export function marketWhen(market, changesAt, now) {
  if (!changesAt) return market === 'holiday' ? 'holiday' : ''
  const at = new Date(changesAt)
  if (market === 'open') return `closes ${formatClock(at, NY_TIME_ZONE)} NY`
  if (market === 'soon') return `opens in ${Math.max(1, Math.ceil((at.getTime() - now) / 60_000))} min`
  return `${market === 'holiday' ? 'holiday · ' : ''}opens ${nyWhen(at)}`
}

// The New York market's state as a pill: colour, dot shape and words all say the
// same thing, so it reads without colour: green and a filled dot when open, red and
// a hollow dot when closed (Cas's choice). In the hour before the open the closed
// pill counts down ("opens in 42 min").
/**
 * @param {{ market: string, changesAt: string | null, now: number }} props
 */
export function MarketStatus({ market, changesAt, now }) {
  const look = LOOK[market] ?? LOOK.closed
  return html`<span role="status" data-market="${market}" class="${`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-wide ${look.box}`}">
    <span aria-hidden="true" class="${`h-2 w-2 rounded-full border-[1.5px] border-current ${look.dot}`}"></span>${look.word}
    <span class="font-normal normal-case tracking-normal text-fg-soft">${marketWhen(market, changesAt, now)}</span>
  </span>`
}
