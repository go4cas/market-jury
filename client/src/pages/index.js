import { html, reactive, onCleanup } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useFetch } from '../composables/useFetch.js'
import { Delta } from '../components/Delta.js'
import { fresh, Loadable } from '../components/Loadable.js'
import { Segmented } from '../components/Segmented.js'
import { StandingsTable } from '../components/StandingsTable.js'
import { Term } from '../components/Term.js'
import { ValueChart } from '../components/ValueChart.js'
import { day } from '../utils/format.js'
import { navigate } from '../utils/nav.js'
import { formatClock, formatDateline, NY_TIME_ZONE, SA_TIME_ZONE } from '../utils/time.js'

export const meta = { layout: 'app', title: 'Market Jury' }

const link = 'inline-flex min-h-11 items-center font-mono text-sm text-brand underline underline-offset-4'

// The Overview: who is doing what, at a glance.
function OverviewPage() {
  useMeta({ title: 'Market Jury' })

  // Keep a number in reactive state: arrow-js proxies objects, and a proxied Date breaks Intl.
  const clock = reactive({ now: Date.now() })
  const timer = setInterval(() => { clock.now = Date.now() }, 15_000)
  try { onCleanup(() => clearInterval(timer)) } catch {}

  const ui = reactive({ track: 'daily' })
  const overview = useFetch('/api/overview')
  const daily = useFetch('/api/series?track=daily')
  const weekly = useFetch('/api/series?track=weekly', { immediate: false })
  const pickTrack = (/** @type {string} */ t) => {
    ui.track = t
    if (t === 'weekly' && !weekly.data()) weekly.refetch()
  }

  return html`
    <div class="flex flex-col gap-7">
      <header class="flex flex-col gap-1.5 border-b border-line pb-3">
        <h1 class="font-display text-4xl font-bold tracking-tight text-fg sm:text-5xl">Market Jury</h1>
        <p class="prompt prompt-caret">4 AI traders | 1 market | you are the jury</p>
        <div class="prompt flex flex-wrap gap-x-4 gap-y-1" data-testid="dateline">
          <span>${() => formatDateline(new Date(clock.now), SA_TIME_ZONE)}</span>
          ${() => (overview.data()?.status.day ? html`<span>Day ${overview.data().status.day}</span>` : '')}
          <span>NY ${() => formatClock(new Date(clock.now), NY_TIME_ZONE)} · SAST ${() => formatClock(new Date(clock.now), SA_TIME_ZONE)}</span>
          ${() => (overview.data() ? html`<span class="text-fg">Market ${overview.data().status.market}</span>` : '')}
        </div>
      </header>

      ${Loadable(overview, (o) => o.status.state === 'setup' || !o.status.latestDate ? NotStarted(o.status.state) : html`
        ${o.movers.length ? html`<p class="flex flex-wrap gap-x-5 gap-y-1 border-b border-line pb-3 font-mono text-sm text-fg" aria-label="${`Biggest moves on ${day(o.status.latestDate)}`}">${o.movers.map((/** @type {any} */ m) => html`<span>${m.ticker} ${Delta(m.changePct)}</span>`)}</p>` : ''}

        <section class="flex flex-col gap-3" aria-labelledby="ahead">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ahead" class="font-display text-[28px] font-semibold leading-8 text-fg">Who is ahead</h2>
            ${Segmented({ label: 'Track', options: [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }], value: () => ui.track, onPick: pickTrack })}
          </div>
          <p class="max-w-prose text-[15px] leading-relaxed text-fg-soft">Each line is one Trader's ${Term('portfolio')} value since day one. The dashed line is ${Term('The Index', 'the index')}: what you'd have if you just bought SPY.</p>
          <div class="${() => (ui.track === 'daily' ? '' : 'hidden')}">${Loadable(daily, (d) => ValueChart({ dates: d.dates, lines: d.series, label: 'Daily track since day one' }))}</div>
          <div class="${() => (ui.track === 'weekly' ? '' : 'hidden')}">${Loadable(weekly, (d) => ValueChart({ dates: d.dates, lines: d.series, label: 'Weekly track since day one' }))}</div>
        </section>

        <section class="flex flex-col gap-2" aria-labelledby="standings">
          <h2 id="standings" class="font-display text-[28px] font-semibold leading-8 text-fg">Standings</h2>
          ${() => fresh(ui.track, StandingsTable({ rows: ui.track === 'weekly' ? o.standings.weekly : o.standings.daily, returnLabel: 'Since start', compact: true }))}
          <a href="/standings" class="${link}" @click="${navigate('/standings')}">See full standings and badges</a>
        </section>

        ${o.recap ? html`
          <article class="flex flex-col gap-2 rounded-panel border border-line bg-surface-raised p-4">
            <p class="prompt">The Columnist · Daily recap · ${day(o.recap.date)}</p>
            <h3 class="font-display text-2xl font-semibold leading-7 text-fg">${o.recap.headline}</h3>
            <p class="text-[15px] leading-relaxed text-fg">${o.recap.body.split(/\n\s*\n/)[0]}</p>
            <a href="/columnist" class="${`${link} self-start`}" @click="${navigate('/columnist')}">Read the recap</a>
          </article>` : ''}
      `)}
    </div>
  `
}

/** @param {string} state */
function NotStarted(state) {
  return html`
    <section class="rounded-panel border border-line bg-surface-raised p-4 shadow-panel">
      <p class="prompt prompt-caret">Status</p>
      <h2 class="mt-2 font-display text-2xl font-semibold text-fg">${state === 'setup' ? 'The experiment has not started yet' : 'Waiting for the first evening run'}</h2>
      <p class="mt-2 max-w-prose text-fg-soft">
        Four AI Traders will each get $1,000 of virtual money and decide every evening what to buy and sell.
        Their portfolios, trades and reasons will show up here once the first trading day has run.
      </p>
    </section>
  `
}

export default OverviewPage
