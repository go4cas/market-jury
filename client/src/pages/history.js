import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useApi } from '../composables/useApi.js'
import { Delta } from '../components/Delta.js'
import { fresh, Loadable } from '../components/Loadable.js'
import { PageHeader } from '../components/PageHeader.js'
import { Segmented } from '../components/Segmented.js'
import { Badges } from '../components/StandingsTable.js'
import { ValueChart } from '../components/ValueChart.js'
import { day, dayRange } from '../utils/format.js'
import { displayName } from '../utils/traders.js'
import { navigate } from '../utils/nav.js'

export const meta = { layout: 'app', title: 'History · Market Jury' }

const link = 'inline-flex min-h-11 items-center font-mono text-sm text-brand underline underline-offset-4'

// History: the whole experiment, newest week first.
function HistoryPage() {
  useMeta({ title: 'History · Market Jury' })
  const ui = reactive({ track: 'daily' })
  const history = useApi(() => `/api/history?track=${ui.track}`)
  const series = useApi(() => `/api/series?track=${ui.track}`)

  return html`
    <div class="flex flex-col gap-6">
      ${() => fresh(history.data()?.day ?? 0, PageHeader({
        eyebrow: history.data()?.day ? `Day ${history.data().day}` : 'The record',
        title: 'History',
        intro: 'The whole experiment, one week at a time. Open a week for its standings and the Columnist\'s report, or tap a day to see every trade and reason from that run.',
      }))}
      ${Segmented({ label: 'Track', options: [{ value: 'daily', label: 'Daily track' }, { value: 'weekly', label: 'Weekly track' }], value: () => ui.track, onPick: (v) => { ui.track = v } })}
      ${Loadable(history, (h) => html`
        <section class="flex flex-col gap-2" aria-labelledby="since">
          <h2 id="since" class="font-display text-2xl font-semibold text-fg">Since day one</h2>
          ${Loadable(series, (s) => ValueChart({ dates: s.dates, lines: s.series, label: `${s.track === 'weekly' ? 'Weekly' : 'Daily'} track since day one` }))}
          <p class="flex flex-wrap gap-x-4 font-mono text-[13px] text-fg-soft"><span>${h.totals.tradingDays} trading days</span><span>${h.totals.trades} trades</span><span>${h.totals.trims} trims</span><span>${h.totals.missedRuns} missed runs</span></p>
        </section>
        <h2 class="mt-2 font-display text-2xl font-semibold text-fg">Week by week</h2>
        ${h.weeks.length ? h.weeks.map((/** @type {any} */ w) => Week(w).key(w.end)) : html`<p class="text-fg-soft">The first week shows up here after the first evening run.</p>`}
      `)}
    </div>
  `
}

/** @param {any} w */
function Week(w) {
  return html`<article class="flex flex-col gap-3 rounded-panel border border-line bg-surface-raised p-4" data-testid="week-card">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <span class="prompt">Week ${w.number} · ${dayRange(w.start, w.end)}${w.complete ? '' : ' · so far'}</span>
      <span class="prompt">${w.trims} ${w.trims === 1 ? 'trim' : 'trims'} · ${w.misses} ${w.misses === 1 ? 'miss' : 'misses'}</span>
    </div>
    ${w.post
      ? html`<h3 class="font-display text-[22px] font-semibold leading-7 text-fg">${w.post.headline}</h3><p class="text-[15px] leading-6 text-fg-soft">${w.post.summary}</p>`
      : html`<p class="text-[15px] text-fg-soft">${w.complete ? 'The Columnist did not write a report for this week.' : 'The Columnist writes the weekly report after the last close of the week.'}</p>`}
    <p class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px] text-fg">
      ${w.best ? html`<span>Best week: ${displayName(w.best.name)} ${Delta(w.best.returnPct)}</span>` : ''}
      ${w.indexReturnPct !== null ? html`<span>The Index ${Delta(w.indexReturnPct)}</span>` : ''}
    </p>
    ${Badges(w.badges)}
    <p class="prompt">Trades each day · tap to open</p>
    <div class="grid grid-cols-5 gap-1.5">${w.days.map((/** @type {any} */ d) => html`<a href="${`/days/${d.date}`}" @click="${navigate(`/days/${d.date}`)}"
        class="flex min-h-11 flex-col items-center justify-center rounded-control border border-line-strong py-1 font-mono text-xs leading-4 text-fg hover:bg-surface-inset"
        aria-label="${`${day(d.date)}: ${d.trades} trades`}"><span>${day(d.date).replace(/ \w+$/, '')}</span><span class="text-fg-soft">${d.trades}</span></a>`)}</div>
    <div class="flex flex-wrap gap-x-4">
      <a href="/columnist" class="${link}" @click="${navigate('/columnist')}">Weekly report</a>
      <a href="${`/standings?kind=week&end=${w.end}`}" class="${link}" @click="${navigate(`/standings?kind=week&end=${w.end}`)}">Week standings</a>
    </div>
  </article>`
}

export default HistoryPage
