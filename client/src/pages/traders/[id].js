import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../../framework/index.js'
import { useApi } from '../../composables/useApi.js'
import { useRoute } from '../../composables/useRoute.js'
import { Delta } from '../../components/Delta.js'
import { Loadable } from '../../components/Loadable.js'
import { Sparkline } from '../../components/Sparkline.js'
import { Term } from '../../components/Term.js'
import { Ticker } from '../../components/Ticker.js'
import { TraderMark } from '../../components/TraderMark.js'
import { ValueChart } from '../../components/ValueChart.js'
import { day, pct, shares, usd } from '../../utils/format.js'
import { alignHistories } from '../../utils/series.js'
import { colourOf, displayName } from '../../utils/traders.js'

export const meta = { layout: 'app', title: 'Trader · Market Jury' }

const th = 'px-2 py-2 text-left font-mono text-xs font-medium uppercase tracking-wide text-fg-soft'
const td = 'border-t border-line px-2 py-2.5 align-middle font-mono text-sm text-fg'
const h2 = 'font-display text-2xl font-semibold text-fg'

/** The behaviour measures shown over time, with how to read each. */
export const MEASURES = /** @type {const} */ ([
  { key: 'cash_share_pct', label: 'Cash share', unit: '%', term: /** @type {const} */ ('cash') },
  { key: 'largest_position_pct', label: 'Largest position', unit: '%', term: /** @type {const} */ ('position') },
  { key: 'positions', label: 'Stocks held', unit: '', term: null },
  { key: 'max_drawdown_pct', label: 'Worst drop so far', unit: '%', term: /** @type {const} */ ('worst drop') },
  { key: 'turnover_pct', label: 'Daily turnover', unit: '%', term: /** @type {const} */ ('turnover') },
  { key: 'avg_holding_days', label: 'Days a holding is kept', unit: '', term: null },
])

// Trader detail: how does this one Trader behave?
function TraderPage() {
  const id = String(useRoute().params().id ?? '')
  useMeta({ title: 'Trader · Market Jury' })
  const request = useApi(() => `/api/traders/${encodeURIComponent(id)}`)
  return html`${Loadable(request, (t) => TraderView(t))}`
}

/** @param {any} d */
function TraderView(d) {
  const t = d.trader
  useMeta({ title: `${displayName(t.name)} · Market Jury` })
  const ui = reactive({ allTrades: false })
  const last = d.metrics.at(-1) ?? {}
  const chart = alignHistories([{ ...t, values: d.values }, ...(d.indexValues.length ? [{ name: 'The Index', kind: 'benchmark', colourSlot: null, values: d.indexValues }] : [])])

  return html`
    <div class="flex flex-col gap-7">
      <header class="flex flex-col gap-2 border-b border-line pb-3">
        <p class="prompt prompt-caret">${t.kind === 'benchmark' ? 'The benchmark: holds SPY from day one' : `${t.provider} · ${t.modelVersion} · ${t.effort} effort`}</p>
        <h1 class="flex items-center gap-3 font-display text-4xl font-semibold tracking-tight text-fg">${TraderMark(t, { size: 'lg' })}${displayName(t.name)}</h1>
        <p class="flex flex-wrap gap-x-4 font-mono text-[13px] text-fg-soft"><span>Joined ${day(t.startedOn)}</span>${t.status !== 'active' ? html`<span>${t.status === 'retiring' ? 'Retiring at the next open' : `Retired ${day(t.retiredOn)}`}</span>` : ''}${d.asOf ? html`<span>Figures at the close of ${day(d.asOf)}</span>` : ''}</p>
      </header>

      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        ${Stat('Portfolio value', html`<span class="font-mono text-fg">${usd(d.totalMicro)}</span>`)}
        ${Stat('Since start', Delta(last.return_pct))}
        ${t.kind === 'benchmark' ? '' : Stat(html`${Term('Vs The Index', 'vs the index')}`, Delta(last.vs_index_pct))}
        ${Stat(html`${Term('Cash')}`, html`<span class="font-mono text-fg">${usd(d.cashMicro)} · ${pct(last.cash_share_pct)}</span>`)}
      </dl>

      ${chart.dates.length ? html`<section class="flex flex-col gap-2"><h2 class="${h2}">Value since joining</h2>${ValueChart({ dates: chart.dates, lines: chart.lines, label: `${displayName(t.name)} against The Index` })}</section>` : ''}

      <section class="flex flex-col gap-2">
        <h2 class="${h2}">What it holds</h2>
        ${d.holdings.length ? html`<div class="-mx-4 overflow-x-auto px-4"><table class="w-full min-w-max border-collapse">
          <thead><tr><th scope="col" class="${th}">${Term('Ticker')}</th><th scope="col" class="${`${th} text-right`}">Shares</th><th scope="col" class="${`${th} text-right`}">Value</th><th scope="col" class="${`${th} text-right`}">Vs ${Term('cost', 'cost basis')}</th><th scope="col" class="${`${th} text-right`}">Of portfolio</th></tr></thead>
          <tbody>${d.holdings.map((/** @type {any} */ h) => html`<tr>
            <td class="${td}">${Ticker(h.ticker, h.name)}</td>
            <td class="${`${td} text-right`}">${shares(h.quantityMicro)}</td>
            <td class="${`${td} text-right`}">${usd(h.valueMicro)}</td>
            <td class="${`${td} text-right`}">${Delta(h.costBasisMicro ? (h.valueMicro / h.costBasisMicro - 1) * 100 : null)}</td>
            <td class="${`${td} text-right`}">${pct(d.totalMicro ? (h.valueMicro / d.totalMicro) * 100 : null)}</td>
          </tr>`)}</tbody></table></div>` : html`<p class="text-fg-soft">Only cash right now.</p>`}
      </section>

      ${d.metrics.length ? html`<section class="flex flex-col gap-2">
        <h2 class="${h2}">How it behaves</h2>
        <p class="max-w-prose text-[15px] text-fg-soft">Each measure at every close since it joined, latest value on the right.</p>
        <dl class="grid gap-3 sm:grid-cols-2">${MEASURES.map((m) => html`<div class="flex items-center justify-between gap-3 rounded-panel border border-line bg-surface-raised px-3 py-2">
          <dt class="text-sm text-fg">${m.term ? Term(m.label, m.term) : m.label}</dt>
          <dd class="flex items-center gap-3">${Sparkline({ values: d.metrics.map((/** @type {any} */ r) => r[m.key] ?? 0), colour: colourOf(t), label: `${m.label} over time` })}<span class="w-16 text-right font-mono text-sm text-fg">${last[m.key] === undefined ? '—' : `${Number(last[m.key]).toFixed(m.unit ? 0 : 1).replace(/\.0$/, '')}${m.unit}`}</span></dd>
        </div>`)}</dl>
      </section>` : ''}

      <section class="flex flex-col gap-3">
        <h2 class="${h2}">${d.totalTrades > d.trades.length ? `The latest ${d.trades.length} of ${d.totalTrades} trades` : 'Every trade'}</h2>
        ${d.trades.length ? html`${() => (ui.allTrades ? d.trades : d.trades.slice(0, 10)).map((/** @type {any} */ x) => html`<article class="flex flex-col gap-1.5 border-t border-line pt-3">
            <p class="flex flex-wrap items-center gap-x-3 font-mono text-[13px] text-fg-soft"><span class="rounded-control border border-line-strong px-2 font-semibold text-fg">${x.side.toUpperCase()}</span><span>${day(x.date)}</span><span>${Ticker(x.ticker, x.name)}</span><span>${shares(x.quantityMicro)} at ${usd(x.priceMicro)}</span><span>${usd(x.amountMicro)}</span></p>
            <p class="border-l-2 border-line-strong pl-3 text-[15px] leading-6 text-fg">“${x.reason}”</p>
          </article>`)}
          ${() => (!ui.allTrades && d.trades.length > 10 ? html`<button type="button" class="inline-flex min-h-11 items-center self-start font-mono text-sm text-brand underline underline-offset-4" @click="${() => { ui.allTrades = true }}">Show ${d.totalTrades > d.trades.length ? 'the latest' : 'all'} ${d.trades.length} trades</button>` : '')}`
          : html`<p class="text-fg-soft">No trades yet.</p>`}
      </section>

      ${t.kind === 'ai' ? html`<section class="flex flex-col gap-3">
        <h2 class="${h2}">Its ${Term('journal')}</h2>
        <p class="max-w-prose text-[15px] text-fg-soft">The notes it keeps for itself between runs, newest first, with its ${Term('market view', 'market view')} that evening.</p>
        ${d.decisions.length ? d.decisions.map((/** @type {any} */ x) => html`<article class="flex flex-col gap-1.5 border-t border-line pt-3">
          <p class="prompt">${day(x.date)}</p>
          <p class="text-[15px] leading-6 text-fg">${x.journal}</p>
          <details><summary class="min-h-11 cursor-pointer py-2.5 font-mono text-sm text-brand">Market view</summary><p class="border-l-2 border-line-strong pl-3 text-[15px] leading-6 text-fg">“${x.marketView}”</p></details>
        </article>`) : html`<p class="text-fg-soft">No decisions yet.</p>`}
      </section>` : ''}
    </div>
  `
}

/** @param {any} label @param {any} value */
function Stat(label, value) {
  return html`<div class="flex flex-col gap-1 rounded-panel border border-line bg-surface-raised p-3"><dt class="prompt">${label}</dt><dd class="text-lg">${value}</dd></div>`
}

export default TraderPage
