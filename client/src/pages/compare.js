import { html, reactive, watch } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useApi } from '../composables/useApi.js'
import { useFetch } from '../composables/useFetch.js'
import { Delta } from '../components/Delta.js'
import { fresh, Loadable } from '../components/Loadable.js'
import { PageHeader } from '../components/PageHeader.js'
import { Term } from '../components/Term.js'
import { TraderName } from '../components/TraderMark.js'
import { ValueChart } from '../components/ValueChart.js'
import { pct, usd } from '../utils/format.js'
import { queryParam } from '../utils/nav.js'
import { alignHistories } from '../utils/series.js'
import { displayName, modelName } from '../utils/traders.js'

export const meta = { layout: 'app', title: 'Compare · Market Jury' }

const select = 'min-h-11 w-full rounded-control border border-line-strong bg-surface-inset px-3 font-mono text-sm text-fg'
const th = 'px-2 py-2 text-left font-mono text-xs font-medium uppercase tracking-wide text-fg-soft'
const td = 'border-t border-line px-2 py-2.5 text-right font-mono text-sm text-fg'

/** Rows of the side-by-side table: how to read each measure and how to show it. */
const ROWS = [
  { label: 'Portfolio value', show: (/** @type {any} */ d) => usd(d.totalMicro) },
  { label: 'Since start', show: (/** @type {any} */ d) => Delta(d.metrics.at(-1)?.return_pct) },
  { label: html`${Term('Vs The Index', 'vs the index')}`, show: (/** @type {any} */ d) => Delta(d.metrics.at(-1)?.vs_index_pct) },
  { label: html`${Term('Worst drop')}`, show: (/** @type {any} */ d) => `${(d.metrics.at(-1)?.max_drawdown_pct ?? 0).toFixed(1)}%` },
  { label: html`${Term('Cash')} share`, show: (/** @type {any} */ d) => pct(d.metrics.at(-1)?.cash_share_pct) },
  { label: 'Stocks held', show: (/** @type {any} */ d) => String(d.holdings.length) },
  { label: 'Trades', show: (/** @type {any} */ d) => String(d.trades.length) },
  { label: html`${Term('Rule breaks')}`, show: (/** @type {any} */ d) => String(d.metrics.reduce((/** @type {number} */ s, /** @type {any} */ m) => s + (m.rule_breaks ?? 0), 0)) },
]

// Compare: two Traders side by side on the same measures and dates.
function ComparePage() {
  useMeta({ title: 'Compare · Market Jury' })
  const list = useFetch('/api/traders')
  const ui = reactive({ a: queryParam('a') ?? '', b: queryParam('b') ?? '' })
  const first = useApi(() => (ui.a ? `/api/traders/${ui.a}` : ''))
  const second = useApi(() => (ui.b ? `/api/traders/${ui.b}` : ''))
  // Until picked: the first model's daily Trader against its weekly one.
  watch(() => list.data(), (l) => {
    if (!l) return
    const ai = l.traders.filter((/** @type {any} */ t) => t.kind === 'ai')
    if (!ui.a && ai[0]) ui.a = String(ai[0].id)
    const partner = ai.find((/** @type {any} */ t) => String(t.id) !== ui.a && modelName(t.name) === modelName(ai[0]?.name ?? '')) ?? ai[1]
    if (!ui.b && partner) ui.b = String(partner.id)
  })

  return html`
    <div class="flex flex-col gap-6">
      ${PageHeader({ eyebrow: 'Side by side', title: 'Compare', intro: 'Two Traders on the same measures and dates. Try one model\'s daily Trader against its weekly one to see whether trading less often changes how it behaves.' })}
      ${Loadable(list, (l) => {
        const picker = (/** @type {'a' | 'b'} */ side, /** @type {string} */ label) => html`<label class="flex flex-1 flex-col gap-1.5"><span class="prompt">${label}</span>
          <select class="${select}" @change="${/** @param {Event} e */ (e) => { ui[side] = /** @type {HTMLSelectElement} */ (e.target).value }}">
            ${l.traders.map((/** @type {any} */ t) => html`<option value="${String(t.id)}" selected="${() => String(t.id) === ui[side]}">${displayName(t.name)}</option>`)}
          </select></label>`
        return html`<div class="flex flex-col gap-3 sm:flex-row">${picker('a', 'First Trader')}${picker('b', 'Second Trader')}</div>
          ${Side(first, second)}`
      })}
    </div>
  `
}

/**
 * @param {ReturnType<typeof useApi>} first
 * @param {ReturnType<typeof useApi>} second
 */
function Side(first, second) {
  return html`${() => {
    const x = first.data()
    const y = second.data()
    if (!x || !y) return Loadable(x ? second : first, () => '')
    const key = `${x.trader.id}-${y.trader.id}`
    const sameModel = x.trader.kind === 'ai' && y.trader.kind === 'ai' && modelName(x.trader.name) === modelName(y.trader.name)
    const index = x.indexValues.length ? x.indexValues : y.indexValues
    const chart = alignHistories([
      { ...x.trader, values: x.values, dotted: sameModel && x.trader.cadence === 'weekly' },
      { ...y.trader, values: y.values, dotted: sameModel && y.trader.cadence === 'weekly' },
      ...(index.length ? [{ name: 'The Index', kind: 'benchmark', colourSlot: null, values: index }] : []),
    ])
    return fresh(key, html`
      ${chart.dates.length ? ValueChart({ dates: chart.dates, lines: chart.lines, label: `${displayName(x.trader.name)} against ${displayName(y.trader.name)}` }) : ''}
      <div class="-mx-4 overflow-x-auto px-4"><table class="w-full min-w-max border-collapse">
        <thead><tr><th scope="col" class="${th}">Measure</th><th scope="col" class="${`${th} text-right`}">${TraderName(x.trader, { size: 'sm' })}</th><th scope="col" class="${`${th} text-right`}">${TraderName(y.trader, { size: 'sm' })}</th></tr></thead>
        <tbody>${ROWS.map((r) => html`<tr><th scope="row" class="border-t border-line px-2 py-2.5 text-left text-sm font-normal text-fg">${r.label}</th><td class="${td}">${r.show(x)}</td><td class="${td}">${r.show(y)}</td></tr>`)}</tbody>
      </table></div>
    `)
  }}`
}

export default ComparePage
