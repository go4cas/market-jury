import { html, reactive, watch } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useApi } from '../composables/useApi.js'
import { useFetch } from '../composables/useFetch.js'
import { Delta } from '../components/Delta.js'
import { fresh, Loadable } from '../components/Loadable.js'
import { PageHeader } from '../components/PageHeader.js'
import { Segmented } from '../components/Segmented.js'
import { Hint } from '../components/Term.js'
import { TraderName } from '../components/TraderMark.js'
import { ValueChart } from '../components/ValueChart.js'
import { day, pct, usd } from '../utils/format.js'
import { queryParam, setQueryParam } from '../utils/nav.js'
import { alignHistories } from '../utils/series.js'
import { differences } from '../utils/tracks.js'
import { displayName, lineStyleOf, modelName } from '../utils/traders.js'

export const meta = { layout: 'app', title: 'Compare · Market Jury' }

const select = 'mj-select w-full'
const th = 'px-2 py-2 text-left font-mono text-xs font-medium uppercase tracking-wide text-fg-soft'
const td = 'border-t border-line px-2 py-2.5 text-right font-mono text-sm text-fg'
const rowHead = 'border-t border-line px-2 py-2.5 text-left text-sm font-normal text-fg'

/** Rows of the side-by-side table: how to read each measure and how to show it. */
const ROWS = [
  { label: 'Portfolio value', show: (/** @type {any} */ d) => usd(d.totalMicro) },
  { label: 'Since start', show: (/** @type {any} */ d) => Delta(d.metrics.at(-1)?.return_pct) },
  { label: html`Vs The Index${Hint('Vs The Index', 'vs the index')}`, show: (/** @type {any} */ d) => Delta(d.metrics.at(-1)?.vs_index_pct) },
  { label: html`Worst drop${Hint('Worst drop')}`, show: (/** @type {any} */ d) => `${(d.metrics.at(-1)?.max_drawdown_pct ?? 0).toFixed(1)}%` },
  { label: html`Cash share${Hint('Cash share', 'cash')}`, show: (/** @type {any} */ d) => pct(d.metrics.at(-1)?.cash_share_pct) },
  { label: 'Stocks held', show: (/** @type {any} */ d) => String(d.holdings.length) },
  { label: 'Trades', show: (/** @type {any} */ d) => String(d.totalTrades) },
  { label: html`Rule breaks${Hint('Rule breaks')}`, show: (/** @type {any} */ d) => String(d.metrics.reduce((/** @type {number} */ s, /** @type {any} */ m) => s + (m.rule_breaks ?? 0), 0)) },
]

/** What a Track's Traders get, in a few words. @param {any} k */
const conditions = (k) => `${k.briefingPack === 'prices_only' ? 'Prices only' : 'Full briefing pack'}${k.webSearch === 'native' ? ", each model's own web search" : k.webSearch === 'shared' ? ', shared web search' : ', no web search'}`

// "3 / 1": orders the Compliance Desk trimmed, then those it rejected; zeros fade (as in Standings).
/** @param {any} r */
const cut = (r) => {
  const n = (/** @type {number} */ v) => html`<span class="${v ? '' : 'text-fg-faint'}">${v}</span>`
  return html`${n(r.trimmed)} / ${n(r.rejected)}`
}

/** Rows of the Track vs Track table. */
const TRACK_ROWS = [
  { label: 'Traders', show: (/** @type {any} */ r) => String(r.traders) },
  { label: 'Gets', show: (/** @type {any} */ r) => html`<span class="whitespace-normal font-sans text-[13px] text-fg-soft">${conditions(r)}</span>` },
  { label: 'Average return', show: (/** @type {any} */ r) => Delta(r.returnPct) },
  { label: html`Vs The Index${Hint('Vs The Index', 'vs the index')}`, show: (/** @type {any} */ r) => Delta(r.vsIndexPct) },
  { label: 'Best Trader', show: (/** @type {any} */ r) => (r.best ? html`<span class="inline-flex flex-col items-end">${displayName(r.best.name)}<span>${Delta(r.best.returnPct)}</span></span>` : '—') },
  { label: 'Worst Trader', show: (/** @type {any} */ r) => (r.worst ? html`<span class="inline-flex flex-col items-end">${displayName(r.worst.name)}<span>${Delta(r.worst.returnPct)}</span></span>` : '—') },
  { label: html`Cash share${Hint('Cash share', 'cash')}`, show: (/** @type {any} */ r) => pct(r.cashSharePct) },
  { label: 'Trades', show: (/** @type {any} */ r) => String(r.trades) },
  { label: html`Trimmed / Rejected${Hint('Trimmed / Rejected')}`, show: cut },
  { label: 'Web searches', show: (/** @type {any} */ r) => String(r.searches) },
  // Only the Trade Master gets costs, as on the Costs screen.
  { label: 'Model cost', show: (/** @type {any} */ r) => usd(r.costMicro), costs: true },
  { label: 'Cost per Trader', show: (/** @type {any} */ r) => usd(r.costPerTraderMicro), costs: true },
]

// Compare: two Traders, or two tracks, side by side on the same measures and dates.
function ComparePage() {
  useMeta({ title: 'Compare · Market Jury' })
  const list = useFetch('/api/traders')
  const ui = reactive({
    mode: queryParam('mode') === 'tracks' ? 'tracks' : 'traders',
    a: queryParam('a') ?? '', b: queryParam('b') ?? '',
    ta: queryParam('ta') ?? '', tb: queryParam('tb') ?? '',
  })
  const first = useApi(() => (ui.mode === 'traders' && ui.a ? `/api/traders/${ui.a}` : ''))
  const second = useApi(() => (ui.mode === 'traders' && ui.b ? `/api/traders/${ui.b}` : ''))
  const both = useApi(() => (ui.mode === 'tracks' && ui.ta && ui.tb ? `/api/compare/tracks?a=${encodeURIComponent(ui.ta)}&b=${encodeURIComponent(ui.tb)}` : ''))
  // Until picked: the first model's daily Trader against the same model in the next track;
  // the first track against the newest.
  watch(() => list.data(), (l) => {
    if (!l) return
    const ai = l.traders.filter((/** @type {any} */ t) => t.kind === 'ai')
    if (!ui.a && ai[0]) ui.a = String(ai[0].id)
    const partner = ai.find((/** @type {any} */ t) => String(t.id) !== ui.a && modelName(t.name) === modelName(ai[0]?.name ?? '')) ?? ai[1]
    if (!ui.b && partner) ui.b = String(partner.id)
    const tracks = l.tracks ?? []
    if (!ui.ta && tracks[0]) ui.ta = tracks[0].slug
    if (!ui.tb && tracks.length > 1) ui.tb = tracks[tracks.length - 1].slug
  })

  return html`
    <div class="flex flex-col gap-6">
      ${PageHeader({ eyebrow: 'Side by side', title: 'Compare', intro: 'Two Traders, or two tracks, on the same measures and dates. Try one model in two tracks to see whether trading less often, or searching the web, changes how it behaves.' })}
      ${Segmented({ label: 'Compare', options: [{ value: 'traders', label: 'Trader vs Trader' }, { value: 'tracks', label: 'Track vs Track' }], value: () => ui.mode, onPick: (v) => { ui.mode = v; setQueryParam('mode', v, 'traders') } })}
      ${Loadable(list, (l) => {
        const tracks = /** @type {Array<{ slug: string, title: string }>} */ (l.tracks ?? [])
        const traders = /** @type {any[]} */ (l.traders)
        const index = traders.filter((t) => t.kind !== 'ai')
        const option = (/** @type {any} */ t, /** @type {'a' | 'b'} */ side) => html`<option value="${String(t.id)}" selected="${() => String(t.id) === ui[side]}">${displayName(t.name)}</option>`
        const picker = (/** @type {'a' | 'b'} */ side, /** @type {string} */ label) => html`<label class="flex flex-1 flex-col gap-1.5"><span class="prompt">${label}</span>
          <select class="${select}" @change="${/** @param {Event} e */ (e) => { ui[side] = /** @type {HTMLSelectElement} */ (e.target).value; setQueryParam(side, ui[side]) }}">
            ${tracks.map((k) => html`<optgroup label="${`${k.title} track`}">${traders.filter((t) => t.kind === 'ai' && t.track === k.slug).map((t) => option(t, side))}</optgroup>`)}
            ${traders.filter((t) => t.kind === 'ai' && !tracks.some((k) => k.slug === t.track)).map((t) => option(t, side))}
            ${index.map((t) => option(t, side))}
          </select></label>`
        const trackPicker = (/** @type {'ta' | 'tb'} */ side, /** @type {string} */ label) => html`<label class="flex flex-1 flex-col gap-1.5"><span class="prompt">${label}</span>
          <select class="${select}" @change="${/** @param {Event} e */ (e) => { ui[side] = /** @type {HTMLSelectElement} */ (e.target).value; setQueryParam(side, ui[side]) }}">
            ${tracks.map((k) => html`<option value="${k.slug}" selected="${() => k.slug === ui[side]}">${`${k.title} track`}</option>`)}
          </select></label>`
        return html`
          <div class="${() => (ui.mode === 'traders' ? 'flex flex-col gap-6' : 'hidden')}">
            <div class="flex flex-col gap-3 sm:flex-row">${picker('a', 'First Trader')}${picker('b', 'Second Trader')}</div>
            ${Side(first, second, tracks)}
          </div>
          <div class="${() => (ui.mode === 'tracks' ? 'flex flex-col gap-6' : 'hidden')}">
            ${tracks.length > 1
              ? html`<div class="flex flex-col gap-3 sm:flex-row">${trackPicker('ta', 'First track')}${trackPicker('tb', 'Second track')}</div>${Tracks(both, tracks)}`
              : html`<p class="text-[15px] text-fg-soft">There is only one track so far.</p>`}
          </div>`
      })}
    </div>
  `
}

/**
 * @param {ReturnType<typeof useApi>} first
 * @param {ReturnType<typeof useApi>} second
 * @param {Array<{ slug: string }>} tracks
 */
function Side(first, second, tracks) {
  return html`${() => {
    const x = first.data()
    const y = second.data()
    if (!x || !y) return Loadable(x ? second : first, () => '')
    const key = `${x.trader.id}-${y.trader.id}`
    const sameModel = x.trader.kind === 'ai' && y.trader.kind === 'ai' && modelName(x.trader.name) === modelName(y.trader.name)
    // One model in two tracks shares its colour, so each track draws its own line style.
    const style = (/** @type {any} */ t) => (sameModel ? lineStyleOf(tracks.findIndex((k) => k.slug === t.track)) : 'solid')
    const index = x.indexValues.length ? x.indexValues : y.indexValues
    const chart = alignHistories([
      { ...x.trader, values: x.values, style: style(x.trader) },
      { ...y.trader, values: y.values, style: style(y.trader) },
      ...(index.length ? [{ name: 'The Index', kind: 'benchmark', colourSlot: null, values: index }] : []),
    ])
    return fresh(key, html`
      ${chart.dates.length ? ValueChart({ dates: chart.dates, lines: chart.lines, label: `${displayName(x.trader.name)} against ${displayName(y.trader.name)}` }) : ''}
      <div class="-mx-4 overflow-x-auto px-4"><table class="w-full min-w-max border-collapse">
        <thead><tr><th scope="col" class="${th}">Measure</th><th scope="col" class="${`${th} text-right`}">${TraderName(x.trader, { size: 'sm' })}</th><th scope="col" class="${`${th} text-right`}">${TraderName(y.trader, { size: 'sm' })}</th></tr></thead>
        <tbody>${ROWS.map((r) => html`<tr><th scope="row" class="${rowHead}">${r.label}</th><td class="${td}">${r.show(x)}</td><td class="${td}">${r.show(y)}</td></tr>`)}</tbody>
      </table></div>
    `)
  }}`
}

/**
 * Track vs Track: each track's average, set to 100 on the day both had started.
 * @param {ReturnType<typeof useApi>} both
 * @param {Array<{ slug: string }>} tracks
 */
function Tracks(both, tracks) {
  return Loadable(both, (c) => {
    if (!c.dates.length) return html`<p class="text-[15px] text-fg-soft">${c.base ? `Both tracks have values to compare from ${day(c.base)}, after that evening's close.` : 'One of these tracks has not started yet.'}</p>`
    const colours = ['var(--color-fg)', 'var(--color-fg-soft)']
    const lines = [
      ...c.lines.map((/** @type {any} */ l, /** @type {number} */ i) => ({
        name: `${l.title} track`, kind: 'track', colourSlot: null, colour: colours[i],
        style: lineStyleOf(Math.max(0, tracks.findIndex((k) => k.slug === l.slug))),
        values: l.values.map((/** @type {number | null} */ v) => (v === null ? null : v * 1_000_000)),
      })),
      ...(c.index ? [{ name: 'The Index', kind: 'benchmark', colourSlot: null, values: c.index.values.map((/** @type {number | null} */ v) => (v === null ? null : v * 1_000_000)) }] : []),
    ]
    const [x, y] = c.rows
    return html`
      <p class="max-w-prose text-[15px] leading-relaxed text-fg-soft">Each line is the average of a track's Traders, set to 100 at the close of ${day(c.base)}, when both tracks had started. So neither gets credit for weeks the other wasn't playing. The dashed line is The Index on the same footing.</p>
      ${ValueChart({ dates: c.dates, lines, label: `${x.title} track against ${y.title} track, from 100`, yValue: (v) => v.toFixed(0) })}
      ${differences(x, y) ? html`<p class="text-[15px] text-fg" data-testid="track-differences">${differences(x, y)}</p>` : ''}
      <div class="-mx-4 overflow-x-auto px-4"><table class="w-full min-w-max border-collapse">
        <thead><tr><th scope="col" class="${th}">Since ${day(c.base, { weekday: false })}</th><th scope="col" class="${`${th} text-right`}">${`${x.title} track`}</th><th scope="col" class="${`${th} text-right`}">${`${y.title} track`}</th></tr></thead>
        <tbody>${TRACK_ROWS.filter((r) => !r.costs || x.costMicro !== undefined).map((r) => html`<tr><th scope="row" class="${rowHead}">${r.label}</th><td class="${td}">${r.show(x)}</td><td class="${td}">${r.show(y)}</td></tr>`)}</tbody>
      </table></div>
      ${c.index ? html`<p class="font-mono text-[13px] text-fg-soft">The Index over the same days: ${Delta(c.index.returnPct)}</p>` : ''}
    `
  })
}

export default ComparePage
