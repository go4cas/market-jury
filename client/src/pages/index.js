import { html, reactive, onCleanup } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useFetch } from '../composables/useFetch.js'
import { Delta } from '../components/Delta.js'
import { LandingHero } from '../components/LandingHero.js'
import { MarketStatus } from '../components/MarketStatus.js'
import { fresh, Loadable } from '../components/Loadable.js'
import { Segmented } from '../components/Segmented.js'
import { StandingsTable } from '../components/StandingsTable.js'
import { Term } from '../components/Term.js'
import { ValueChart } from '../components/ValueChart.js'
import { day } from '../utils/format.js'
import { navigate } from '../utils/nav.js'
import { formatClock, formatDateline, NY_TIME_ZONE, viewerTimeZone, zoneLabel } from '../utils/time.js'

export const meta = { layout: 'app', title: 'Market Jury' }

const here = viewerTimeZone()

/**
 * "NY 02:32 · SAST 08:32": the market's clock, then the reader's own (just one when they match).
 * @param {Date} now
 */
function clockLine(now) {
  const ny = `NY ${formatClock(now, NY_TIME_ZONE)}`
  const mine = `${zoneLabel(now, here)} ${formatClock(now, here)}`
  return formatClock(now, here) === formatClock(now, NY_TIME_ZONE) ? ny : `${ny} · ${mine}`
}

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
      <div class="prompt flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="dateline">
        <span>${() => formatDateline(new Date(clock.now), here)}</span>
        ${() => (overview.data()?.status.day ? html`<span>Day ${overview.data().status.day}</span>` : '')}
        <span>${() => clockLine(new Date(clock.now))}</span>
        ${() => (overview.data() ? MarketStatus({ market: overview.data().status.market, changesAt: overview.data().status.changesAt, now: clock.now }) : '')}
      </div>

      ${Loadable(overview, (o) => html`${LandingHero({ hero: o.hero, day: o.status.day, started: o.status.state !== 'setup', onAhead: toAhead, onCast: navigate('/cast') })}
        ${o.status.state === 'setup' || !o.status.latestDate ? NotStarted(o.status.state) : Board(o)}`)}
    </div>
  `

  /** @param {any} o */
  function Board(o) {
    return html`
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
      `
  }
}

// "See who is ahead": scroll to the chart (instantly, if the reader asked for less motion).
function toAhead() {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.getElementById('ahead')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
}

/** @param {string} state */
function NotStarted(state) {
  return html`
    <section class="rounded-panel border border-line bg-surface-raised p-4 shadow-panel">
      <p class="prompt prompt-caret">Status</p>
      <h2 id="ahead" class="mt-2 font-display text-2xl font-semibold text-fg">${state === 'setup' ? 'The experiment has not started yet' : 'Waiting for the first evening run'}</h2>
      <p class="mt-2 max-w-prose text-fg-soft">
        Four AI Traders will each get $1,000 of virtual money and decide every evening what to buy and sell.
        Their portfolios, trades and reasons will show up here once the first trading day has run.
      </p>
    </section>
  `
}

export default OverviewPage
