import { html } from '@arrow-js/core'
import { go } from '../framework/router.js'
import { pct, signedPct, usd } from '../utils/format.js'
import { Delta } from './Delta.js'
import { Hint } from './Term.js'
import { TraderName } from './TraderMark.js'

/**
 * @typedef {object} StandingRow
 * @property {number} rank
 * @property {number} traderId
 * @property {string} name
 * @property {string} kind
 * @property {number | null} colourSlot
 * @property {string} status
 * @property {number} totalMicro
 * @property {number} cashMicro
 * @property {number} returnPct
 * @property {number | null} vsIndexPct
 * @property {number} sinceStartPct
 * @property {number} maxDrawdownPct
 * @property {number} cashSharePct
 * @property {number} trades
 * @property {number} ruleBreaks
 */

const th = 'px-2 py-2 text-left font-mono text-xs font-medium uppercase tracking-wide text-fg-soft'
const td = 'border-t border-line px-2 py-2.5 align-middle'

/** @param {StandingRow} r */
const traderLink = (r) => html`<a href="${`/traders/${r.traderId}`}" class="inline-flex min-h-11 items-center hover:underline" @click="${/** @param {Event} e */ (e) => { e.preventDefault(); go(`/traders/${r.traderId}`) }}">${TraderName(r, { size: 'sm' })}${r.status !== 'active' && r.kind === 'ai' ? html`<span class="ml-2 prompt">${r.status}</span>` : ''}</a>`

/**
 * The leaderboard. Value and cash are at the period's last close; only the
 * return follows the period. `compact` (Overview) shows four columns: rank,
 * Trader, value with the return under it, and cash. The full table adds
 * behaviour so a lucky gambler can't hide; under 640px it folds into two-line
 * rows (the second a muted summary) so nothing scrolls sideways.
 * @param {{ rows: StandingRow[], returnLabel: string, compact?: boolean }} props
 */
export function StandingsTable({ rows, returnLabel, compact = false }) {
  if (!rows.length) return html`<p class="text-fg-soft">No closing values yet. The table fills in after the first evening run.</p>`
  const wide = `${th} hidden text-right sm:table-cell`
  const wideTd = `${td} hidden text-right font-mono text-fg sm:table-cell`
  return html`
    <div class="${compact ? '' : 'sm:-mx-4 sm:overflow-x-auto sm:px-4'}">
      <table class="${`w-full border-collapse text-sm${compact ? '' : ' sm:min-w-max'}`}">
        <thead><tr>
          <th scope="col" class="${th}">#</th>
          <th scope="col" class="${th}">Trader</th>
          <th scope="col" class="${`${th} text-right`}">Value${Hint('Value')}</th>
          ${compact ? '' : html`<th scope="col" class="${`${th} text-right`}">${returnLabel}</th>`}
          ${compact ? '' : html`<th scope="col" class="${wide}">Vs The Index${Hint('Vs The Index', 'vs the index')}</th>`}
          ${compact ? '' : html`<th scope="col" class="${wide}">Worst drop${Hint('Worst drop')}</th>`}
          <th scope="col" class="${compact ? `${th} text-right` : wide}">Cash${Hint('Cash')}</th>
          ${compact ? '' : html`<th scope="col" class="${wide}">Trades</th>`}
          ${compact ? '' : html`<th scope="col" class="${wide}">Rule breaks${Hint('Rule breaks')}</th>`}
        </tr></thead>
        <tbody>${rows.map((r) => html`<tr>
          <td class="${`${td} font-mono text-fg-soft`}">${r.rank}</td>
          <td class="${td}">${traderLink(r)}</td>
          <td class="${`${td} whitespace-nowrap text-right font-mono text-fg`}">${usd(r.totalMicro)}${compact ? html`<span class="block text-xs">${Delta(r.returnPct)}</span>` : ''}</td>
          ${compact ? '' : html`<td class="${`${td} text-right`}">${Delta(r.returnPct)}</td>`}
          ${compact ? '' : html`<td class="${`${td} hidden text-right sm:table-cell`}">${r.kind === 'benchmark' ? html`<span class="font-mono text-fg-faint">—</span>` : Delta(r.vsIndexPct)}</td>`}
          ${compact ? '' : html`<td class="${wideTd}">${drop(r)}</td>`}
          <td class="${compact ? `${td} whitespace-nowrap text-right font-mono text-fg` : `${wideTd} whitespace-nowrap`}">${cash(r)}</td>
          ${compact ? '' : html`<td class="${wideTd}">${r.trades}</td>`}
          ${compact ? '' : html`<td class="${wideTd}">${r.ruleBreaks}</td>`}
        </tr>${compact ? '' : html`<tr class="sm:hidden" data-testid="standings-summary"><td></td><td colspan="3" class="pb-2.5 font-mono text-xs text-fg-soft">${summary(r).map((item, i) => html`${i ? ' · ' : ''}<span class="whitespace-nowrap">${item}</span>`)}</td></tr>`}`.key(r.traderId))}</tbody>
      </table>
    </div>
  `
}

/** @param {StandingRow} r */
const drop = (r) => (r.maxDrawdownPct ? `−${r.maxDrawdownPct.toFixed(1)}%` : '0.0%')

// The Index holds SPY, so it shows no cash of its own.
/** @param {StandingRow} r */
const cash = (r) => (r.kind === 'benchmark'
  ? html`<span class="text-fg-faint">—</span>`
  : html`${usd(r.cashMicro)}<span class="block text-xs text-fg-soft">${pct(r.cashSharePct)}</span>`)

/**
 * The phone row's second line: "Cash $312 (29%) · vs Index +7.7% · Worst drop −1.2% · 12 trades · 0 rule breaks".
 * @param {StandingRow} r
 */
function summary(r) {
  const index = r.kind === 'benchmark'
  return [
    index ? 'Cash —' : `Cash ${usd(r.cashMicro, { whole: true })} (${pct(r.cashSharePct)})`,
    ...(index ? [] : [`vs Index ${signedPct(r.vsIndexPct)}`]),
    `Worst drop ${drop(r)}`,
    `${r.trades} ${r.trades === 1 ? 'trade' : 'trades'}`,
    `${r.ruleBreaks} ${r.ruleBreaks === 1 ? 'rule break' : 'rule breaks'}`,
  ]
}

/**
 * @param {Array<{ badge: string, name: string }>} badges
 */
export function Badges(badges) {
  if (!badges.length) return ''
  return html`<ul class="flex flex-wrap gap-1.5" aria-label="Badges">${badges.map((b) => html`<li class="rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-xs text-fg">${b.badge} · ${b.name}</li>`)}</ul>`
}
