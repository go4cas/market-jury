import { html, reactive } from '@arrow-js/core'
import { go } from '../framework/router.js'
import { day, shares, usd } from '../utils/format.js'
import { displayName, modelName } from '../utils/traders.js'
import { navigate } from '../utils/nav.js'
import { PageHeader } from './PageHeader.js'
import { Segmented } from './Segmented.js'
import { Term } from './Term.js'
import { Ticker } from './Ticker.js'
import { TraderMark } from './TraderMark.js'

/**
 * @typedef {object} Order
 * @property {number} id
 * @property {'buy' | 'sell'} side
 * @property {string} ticker
 * @property {string | null} name the company's name
 * @property {number | null} amountMicro
 * @property {boolean} sellAll
 * @property {string} reason
 * @property {'accepted' | 'trimmed' | 'rejected'} verdict
 * @property {string | null} verdictNote
 * @property {number | null} approvedAmountMicro
 * @property {string} status
 * @property {string | null} fillNote
 * @property {number | null} priceMicro
 * @property {number | null} quantityMicro
 * @property {number | null} filledMicro
 * @property {string | null} filledOn
 */

const warn = 'flex gap-2 rounded-control border border-warn bg-warn-wash px-3 py-2.5 text-sm leading-5 text-fg'
const quote = 'border-l-2 border-line-strong pl-3 text-[15px] leading-6 text-fg'

/** @param {Order} o */
function wanted(o) {
  if (o.side === 'sell') return o.sellAll ? `sell all of its ${o.ticker}` : `sell ${usd(o.amountMicro)} of ${o.ticker}`
  return `buy ${usd(o.amountMicro)} of ${o.ticker}`
}

/** @param {Order} o @param {string | null} fillDate */
function title(o, fillDate) {
  if (o.status === 'filled') {
    return o.side === 'buy'
      ? `Bought ${usd(o.filledMicro)} of ${o.ticker} at ${usd(o.priceMicro)}`
      : `Sold ${shares(o.quantityMicro ?? 0)} ${o.ticker} for ${usd(o.filledMicro)} at ${usd(o.priceMicro)}`
  }
  if (o.status === 'queued') {
    const amount = o.side === 'sell' && o.sellAll ? `all of its ${o.ticker}` : `${usd(o.approvedAmountMicro ?? o.amountMicro)} of ${o.ticker}`
    return `${o.side === 'buy' ? 'Buying' : 'Selling'} ${amount} at ${fillDate ? `${day(fillDate)}'s` : 'the next'} open`
  }
  return `Wanted to ${wanted(o)}`
}

/** @param {Order} o */
function notes(o) {
  const out = []
  if (o.verdict === 'trimmed') out.push(html`<div class="${warn}"><span aria-hidden="true">!</span><div><strong>${Term('Trimmed')} from ${usd(o.amountMicro)} to ${usd(o.approvedAmountMicro)}</strong> by the Compliance Desk. ${o.verdictNote ?? ''}</div></div>`)
  if (o.verdict === 'rejected') out.push(html`<div class="${warn}"><span aria-hidden="true">!</span><div><strong>Rejected</strong> by the Compliance Desk. ${o.verdictNote ?? ''}</div></div>`)
  if (o.status === 'cancelled' || (o.status === 'filled' && o.fillNote)) out.push(html`<div class="${warn}"><span aria-hidden="true">!</span><div><strong>${o.status === 'cancelled' ? 'Not filled' : 'Scaled down'}</strong> by the Opening Bell. ${o.fillNote ?? ''}</div></div>`)
  return out
}

/** @param {Order} o @param {string | null} fillDate */
function OrderBlock(o, fillDate) {
  return html`<div class="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
    <div class="flex items-start justify-between gap-3">
      <h3 class="font-display text-xl font-semibold leading-7 text-fg">${title(o, fillDate)}</h3>
      <span class="shrink-0 rounded-control border border-line-strong px-2 py-0.5 font-mono text-xs font-semibold text-fg">${o.side.toUpperCase()}</span>
    </div>
    ${o.name ? html`<p class="text-sm">${Ticker(o.ticker, o.name)}</p>` : ''}
    <p class="${quote}">“${o.reason}”</p>
    ${notes(o)}
    ${o.status === 'filled' ? html`<p class="flex flex-wrap gap-x-4 font-mono text-[13px] text-fg-soft"><span>${shares(o.quantityMicro ?? 0)} shares</span><span>Filled ${day(o.filledOn)} ${Term('at the open')}</span></p>` : ''}
  </div>`
}

/**
 * @param {any} c a card from /api/days
 * @param {string | null} fillDate
 */
function Card(c, fillDate) {
  return html`<article class="flex flex-col gap-3 rounded-panel border border-line bg-surface-raised p-4" data-testid="trade-card">
    <div class="flex items-center justify-between gap-2">
      <span class="flex items-center gap-2">${TraderMark(c)}<span class="flex flex-col"><a href="${`/traders/${c.traderId}`}" class="font-semibold text-fg hover:underline" @click="${navigate(`/traders/${c.traderId}`)}">${displayName(c.name)}</a>
        <span class="text-xs text-fg-soft">${c.cashAfterMicro !== null ? `Cash after the open ${usd(c.cashAfterMicro)}` : c.decided ? `Decided ${day(c.date)}` : ''}</span></span></span>
      ${!c.orders.length ? html`<span class="shrink-0 rounded-control border border-line-strong px-2 py-0.5 font-mono text-xs font-semibold text-fg">HOLD</span>` : ''}
    </div>
    ${c.orders.length ? c.orders.map((/** @type {Order} */ o) => OrderBlock(o, fillDate)) : c.decided
      ? html`<h3 class="font-display text-xl font-semibold leading-7 text-fg">Made no trades</h3>${c.noTradesReason ? html`<p class="${quote}">“${c.noTradesReason}”</p>` : ''}`
      : html`<h3 class="font-display text-xl font-semibold leading-7 text-fg">Couldn't decide, so it held</h3><p class="text-[15px] text-fg-soft">${c.error ?? 'Its model did not give a usable answer this time.'}</p>`}
    ${c.marketView ? html`<details class="text-[15px] text-fg"><summary class="min-h-11 cursor-pointer py-2.5 font-mono text-sm text-brand">Its ${Term('market view', 'market view')}</summary><p class="${quote}">“${c.marketView}”</p></details>` : ''}
  </article>`
}

/**
 * The run of one trading evening: one card per Trader with what it bought,
 * sold or held, the price, and its reasons in its own words.
 * @param {any} d the /api/days answer
 * @param {{ latest: boolean }} options
 */
export function DayView(d, { latest }) {
  if (!d.date) {
    return html`${PageHeader({ eyebrow: 'The last run', title: 'Yesterday', intro: 'No Trader has decided anything yet. The first cards appear after the first evening run.' })}`
  }
  const ui = reactive({ model: 'all' })
  const models = [...new Set(d.cards.map((/** @type {any} */ c) => modelName(c.name)))]
  const c = d.counts
  const traders = d.cards.filter((/** @type {any} */ x) => x.decided).length
  const summary = `${c.orders} ${c.orders === 1 ? 'order' : 'orders'} from ${traders} ${traders === 1 ? 'Trader' : 'Traders'}.${c.trimmed ? ` ${c.trimmed} trimmed by the Compliance Desk.` : ''}${c.rejected ? ` ${c.rejected} rejected.` : ''}`
  const btn = 'inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong font-mono text-fg hover:bg-surface-inset'

  return html`
    <div class="flex flex-col gap-5">
      ${PageHeader({
        eyebrow: `Decided ${day(d.date)} after close · ${d.fillDate ? `fills ${day(d.fillDate)}` : 'fills at the next open'}`,
        title: latest ? 'Yesterday' : day(d.date),
        intro: `${summary} Step back to see any earlier day the same way.`,
      })}
      <nav class="grid grid-cols-[44px_1fr_44px] gap-2" aria-label="Choose a trading day">
        ${d.prev
          ? html`<a href="${`/days/${d.prev}`}" class="${btn}" aria-label="Previous trading day" @click="${navigate(`/days/${d.prev}`)}">‹</a>`
          : html`<span class="${`${btn} opacity-40`}" aria-hidden="true">‹</span>`}
        <label class="${`${btn} relative px-3 text-sm`}">
          <span>${day(d.date)}${d.day ? ` · Day ${d.day}` : ''} ▾</span>
          <input type="date" value="${d.date}" aria-label="Pick a date" class="absolute inset-0 cursor-pointer opacity-0"
            @change="${/** @param {Event} e */ (e) => { const v = /** @type {HTMLInputElement} */ (e.target).value; if (v) go(`/days/${v}`) }}" />
        </label>
        ${d.next
          ? html`<a href="${`/days/${d.next}`}" class="${btn}" aria-label="Next trading day" @click="${navigate(`/days/${d.next}`)}">›</a>`
          : html`<span class="${`${btn} opacity-40`}" aria-hidden="true">›</span>`}
      </nav>
      ${models.length > 1 ? Segmented({ label: 'Show Traders', options: [{ value: 'all', label: 'All' }, ...models.map((m) => ({ value: m, label: m }))], value: () => ui.model, onPick: (v) => { ui.model = v } }) : ''}
      ${() => d.cards.filter((/** @type {any} */ x) => ui.model === 'all' || modelName(x.name) === ui.model).map((/** @type {any} */ x) => Card({ ...x, date: d.date }, d.fillDate).key(x.traderId))}
      ${d.cards.length ? '' : html`<p class="text-fg-soft">No Trader was due to decide on ${day(d.date)}.</p>`}
      <p class="font-mono text-xs text-fg-soft">Reasons are quoted exactly as each Trader wrote them.</p>
    </div>
  `
}
