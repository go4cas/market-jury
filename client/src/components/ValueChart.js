import { html, watch } from '@arrow-js/core'
import { onLeave } from '../framework/lifecycle.js'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { uiState } from '../state/uiState.js'
import { day, usd } from '../utils/format.js'
import { colourOf, displayName } from '../utils/traders.js'
import { Swatch } from './TraderMark.js'

let nextId = 0

/**
 * @typedef {object} Line
 * @property {string} name
 * @property {string} kind
 * @property {number | null} colourSlot
 * @property {(number | null)[]} values micro-dollars, one per date (null: not taking part yet)
 * @property {boolean} [dotted] the weekly track of a model in Compare
 */

/** @param {string} name */
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/**
 * Portfolio value over time: one solid line per Trader in its colour, The
 * Index grey and dashed. Drawn with uPlot; redrawn when the look changes.
 * @param {{ dates: string[], lines: Line[], label: string, height?: number }} props
 */
export function ValueChart({ dates, lines, label, height = 220 }) {
  const id = `chart-${++nextId}`
  /** @type {uPlot | null} */
  let plot = null
  /** @type {ResizeObserver | null} */
  let observer = null

  const xs = dates.map((d) => Date.parse(`${d}T12:00:00Z`) / 1000)
  const data = /** @type {uPlot.AlignedData} */ ([xs, ...lines.map((l) => l.values.map((v) => (v === null ? null : v / 1_000_000)))])

  function draw() {
    const el = document.getElementById(id)
    if (!el) return false
    plot?.destroy()
    const axis = { stroke: token('--color-fg-soft'), grid: { stroke: token('--color-chart-grid'), width: 1 }, ticks: { show: false }, font: '12px "IBM Plex Mono", monospace' }
    plot = new uPlot({
      width: el.clientWidth || 320,
      height,
      legend: { show: false },
      cursor: { points: { show: false }, x: true, y: false, drag: { x: false, y: false } },
      scales: { x: { time: false } },
      axes: [
        { ...axis, values: (_u, ticks) => ticks.map((t) => day(new Date(t * 1000).toISOString().slice(0, 10), { weekday: false })), space: 70 },
        { ...axis, side: 1, size: 64, values: (_u, ticks) => ticks.map((t) => usd(t * 1_000_000, { whole: true })) },
      ],
      series: [
        {},
        ...lines.map((l) => ({
          label: l.name,
          stroke: l.kind === 'benchmark' ? token('--color-index') : token(colourOf(l).slice(4, -1)),
          width: l.kind === 'benchmark' ? 2 : l.dotted ? 2 : 2.5,
          dash: l.kind === 'benchmark' ? [6, 5] : l.dotted ? [2, 4] : undefined,
          points: { show: dates.length === 1 },
          spanGaps: false,
        })),
      ],
    }, data, el)
    return true
  }

  // The element exists once the template is in the page.
  let tries = 0
  const mount = () => { if (!draw() && tries++ < 20) requestAnimationFrame(mount) }
  requestAnimationFrame(mount)
  // Redraw in the new colours when the look changes; stop once the chart has left the page.
  const [, stop] = watch(() => uiState.mode, () => requestAnimationFrame(() => {
    if (plot && !document.getElementById(id)) { plot.destroy(); plot = null; stop(); observer?.disconnect(); return }
    draw()
  }))
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => { const el = document.getElementById(id); if (plot && el && el.clientWidth !== plot.width) plot.setSize({ width: el.clientWidth, height }) })
    requestAnimationFrame(() => { const el = document.getElementById(id); if (el) observer?.observe(el) })
  }
  onLeave(() => { stop(); observer?.disconnect(); plot?.destroy(); plot = null })

  const last = (/** @type {Line} */ l) => [...l.values].reverse().find((v) => v !== null) ?? null
  const summary = `${label}: ${lines.map((l) => `${displayName(l.name)} ${usd(last(l), { whole: true })}`).join(', ')}`

  return html`
    <figure class="m-0 flex flex-col gap-2">
      <div id="${id}" role="img" aria-label="${summary}" style="${`min-height: ${height}px`}"></div>
      <figcaption class="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg">${lines.map((l) => html`<span class="inline-flex items-center gap-1.5">${Swatch(l)}${displayName(l.name)}</span>`)}</figcaption>
    </figure>
  `
}
