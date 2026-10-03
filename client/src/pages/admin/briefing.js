import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../../framework/index.js'
import { useApi } from '../../composables/useApi.js'
import { Delta } from '../../components/Delta.js'
import { fresh, Loadable } from '../../components/Loadable.js'
import { PageHeader } from '../../components/PageHeader.js'
import { Segmented } from '../../components/Segmented.js'
import { Term } from '../../components/Term.js'
import { Ticker } from '../../components/Ticker.js'
import { day } from '../../utils/format.js'
import { formatClock, viewerTimeZone, zoneLabel } from '../../utils/time.js'

export const meta = { layout: 'app', title: 'Briefing pack · Market Jury' }

/**
 * "08:32 SAST": a timestamp in the reader's own time zone.
 * @param {string} iso
 */
const at = (iso) => `${formatClock(new Date(iso), viewerTimeZone())} ${zoneLabel(new Date(iso), viewerTimeZone())}`

const th = 'px-2 py-2 text-left font-mono text-xs font-medium uppercase tracking-wide text-fg-soft'
const td = 'whitespace-nowrap border-t border-line px-2 py-2 text-right font-mono text-sm text-fg'

// Briefing pack: what did the Traders see? Prices, biggest moves and headlines, by date.
function BriefingPage() {
  useMeta({ title: 'Briefing pack · Market Jury' })
  const ui = reactive({ kind: 'daily', date: '', query: '' })
  const request = useApi(() => `/api/admin/packs?kind=${ui.kind}${ui.date ? `&date=${ui.date}` : ''}`)

  return html`
    <div class="flex flex-col gap-6">
      ${PageHeader({ eyebrow: 'Trade Master only', title: 'Briefing pack', intro: html`The ${Term('briefing pack')} every Trader read before deciding, exactly as it was built. Useful when a reason mentions news you want to check.` })}
      ${Segmented({ label: 'Pack', options: [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }], value: () => ui.kind, onPick: (v) => { ui.date = ''; ui.kind = v } })}
      ${Loadable(request, (r) => {
        if (!r.pack) return html`<p class="text-fg-soft">No ${r.kind} briefing pack has been built yet.</p>`
        const p = r.pack
        const col = (/** @type {string} */ name) => p.prices.columns.indexOf(name)
        const change = p.kind === 'weekly' ? 'chg_week' : 'chg_1d'
        return html`
          <label class="flex flex-col gap-1.5 sm:max-w-xs"><span class="prompt">Pick a date</span>
            <select class="mj-select" @change="${/** @param {Event} e */ (e) => { ui.date = /** @type {HTMLSelectElement} */ (e.target).value }}">
              ${r.dates.map((/** @type {string} */ d) => html`<option value="${d}" selected="${d === r.date ? true : false}">${day(d, { year: true })}</option>`)}
            </select></label>
          <p class="font-mono text-[13px] text-fg-soft">Built ${day(r.date)} at ${at(r.createdAt)} · ${p.prices.rows.length} tickers${p.missing.length ? ` · no prices for ${p.missing.join(', ')}` : ''}</p>
          <section class="flex flex-col gap-2"><h2 class="font-display text-2xl font-semibold text-fg">The market</h2>
            <p class="text-[15px] text-fg">${p.market.rose} rose, ${p.market.fell} fell, ${p.market.unchanged} unchanged.${p.market.spy ? html` SPY closed at $${p.market.spy.close.toFixed(2)} ${Delta(p.market.spy[change])}.` : ''}</p>
            <div class="grid grid-cols-1 gap-1 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-baseline sm:gap-x-4 sm:gap-y-2">${[['Rose most', p.market.biggestRises], ['Fell most', p.market.biggestFalls]].map(([label, moves]) => html`<p class="prompt whitespace-nowrap">${label}</p>
              <ul class="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[15px] text-fg sm:mb-0 sm:flex sm:flex-wrap">${moves.map((/** @type {any} */ m) => html`<li class="whitespace-nowrap">${m.ticker} ${Delta(m.change)}</li>`)}</ul>`)}</div>
          </section>
          <section class="flex flex-col gap-2"><h2 class="font-display text-2xl font-semibold text-fg">Headlines</h2>
            <p class="text-sm text-fg-soft">Third-party text, given to the Traders as data only.</p>
            <ul class="flex flex-col">${p.headlines.map((/** @type {any} */ h) => html`<li class="border-t border-line py-2 text-[15px] text-fg">${h.headline}<span class="block font-mono text-xs text-fg-soft">${h.source} · ${at(h.publishedAt)}${h.tickers.length ? ` · ${h.tickers.join(', ')}` : ''}</span></li>`)}</ul>
          </section>
          <section class="flex flex-col gap-2"><h2 class="font-display text-2xl font-semibold text-fg">Prices</h2>
            <label class="block sm:max-w-xs"><span class="prompt">Find a ticker or name</span><input class="mt-1.5 min-h-11 w-full rounded-control border border-line-strong bg-surface-inset px-3 font-mono text-[15px] text-fg outline-none focus:border-brand focus:bg-surface-raised" type="search" @input="${/** @param {Event} e */ (e) => { ui.query = /** @type {HTMLInputElement} */ (e.target).value.trim().toLowerCase() }}" /></label>
            ${() => {
              const rows = p.prices.rows.filter((/** @type {any[]} */ row) => !ui.query || String(row[0]).toLowerCase().startsWith(ui.query) || String(r.names[row[0]] ?? '').toLowerCase().includes(ui.query))
              // Every ticker is listed; the table scrolls inside its own box, header kept in view.
              // It fits a phone's width: under 640px only Ticker (name below it), Close and
              // Day show, so nothing needs scrolling sideways.
              return fresh(ui.query, html`<p class="text-sm text-fg-soft">${ui.query ? `${rows.length} of ${p.prices.rows.length} match.` : `All ${p.prices.rows.length}, scroll to see them.`}</p>
              <div class="max-h-[32rem] overflow-auto overscroll-contain rounded-control border border-line" tabindex="0" role="region" aria-label="Prices for every ticker"><table class="w-full border-collapse">
                <thead class="sticky top-0 bg-surface-raised"><tr><th scope="col" class="${th}">Ticker</th><th scope="col" class="${`${th} hidden text-right sm:table-cell`}">Open</th><th scope="col" class="${`${th} text-right`}">Close</th><th scope="col" class="${`${th} text-right`}">${p.kind === 'weekly' ? 'Week' : 'Day'}</th><th scope="col" class="${`${th} hidden text-right sm:table-cell`}">Month</th></tr></thead>
                <tbody>${rows.map((/** @type {any[]} */ row) => html`<tr><td class="border-t border-line px-2 py-2 text-sm">${Ticker(row[0], r.names[row[0]], { stacked: true })}</td><td class="${`${td} hidden sm:table-cell`}">${row[col('open')].toFixed(2)}</td><td class="${td}">${row[col('close')].toFixed(2)}</td><td class="${td}">${Delta(row[col(change)])}</td><td class="${`${td} hidden sm:table-cell`}">${Delta(row[col('chg_1m')])}</td></tr>`.key(row[0]))}</tbody>
              </table></div>`)
            }}
          </section>
        `
      })}
    </div>
  `
}

export default BriefingPage
