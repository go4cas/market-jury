import { html } from '@arrow-js/core'
import { go } from '../framework/router.js'
import { pct } from '../utils/format.js'
import { Delta } from './Delta.js'
import { Term } from './Term.js'
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
 * The leaderboard. `compact` shows rank, Trader, return and cash share (Overview);
 * the full table adds behaviour so a lucky gambler can't hide.
 * @param {{ rows: StandingRow[], returnLabel: string, compact?: boolean }} props
 */
export function StandingsTable({ rows, returnLabel, compact = false }) {
  if (!rows.length) return html`<p class="text-fg-soft">No closing values yet. The table fills in after the first evening run.</p>`
  return html`
    <div class="-mx-4 overflow-x-auto px-4">
      <table class="w-full min-w-max border-collapse text-sm">
        <thead><tr>
          <th scope="col" class="${th}">#</th>
          <th scope="col" class="${th}">Trader</th>
          <th scope="col" class="${`${th} text-right`}">${returnLabel}</th>
          ${compact ? '' : html`<th scope="col" class="${`${th} text-right`}">${Term('Vs The Index', 'vs the index')}</th>`}
          ${compact ? '' : html`<th scope="col" class="${`${th} text-right`}">${Term('Worst drop')}</th>`}
          <th scope="col" class="${`${th} text-right`}">${Term('Cash')}</th>
          ${compact ? '' : html`<th scope="col" class="${`${th} text-right`}">Trades</th>`}
          ${compact ? '' : html`<th scope="col" class="${`${th} text-right`}">${Term('Rule breaks')}</th>`}
        </tr></thead>
        <tbody>${rows.map((r) => html`<tr>
          <td class="${`${td} font-mono text-fg-soft`}">${r.rank}</td>
          <td class="${td}">${traderLink(r)}</td>
          <td class="${`${td} text-right`}">${Delta(r.returnPct)}</td>
          ${compact ? '' : html`<td class="${`${td} text-right`}">${r.kind === 'benchmark' ? html`<span class="font-mono text-fg-faint">—</span>` : Delta(r.vsIndexPct)}</td>`}
          ${compact ? '' : html`<td class="${`${td} text-right font-mono text-fg`}">${r.maxDrawdownPct ? `−${r.maxDrawdownPct.toFixed(1)}%` : '0.0%'}</td>`}
          <td class="${`${td} text-right font-mono text-fg`}">${pct(r.cashSharePct)}</td>
          ${compact ? '' : html`<td class="${`${td} text-right font-mono text-fg`}">${r.trades}</td>`}
          ${compact ? '' : html`<td class="${`${td} text-right font-mono text-fg`}">${r.ruleBreaks}</td>`}
        </tr>`.key(r.traderId))}</tbody>
      </table>
    </div>
  `
}

/**
 * @param {Array<{ badge: string, name: string }>} badges
 */
export function Badges(badges) {
  if (!badges.length) return ''
  return html`<ul class="flex flex-wrap gap-1.5" aria-label="Badges">${badges.map((b) => html`<li class="rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-xs text-fg">${b.badge} · ${b.name}</li>`)}</ul>`
}
