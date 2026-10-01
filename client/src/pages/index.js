import { html, reactive, onCleanup } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { formatClock, formatDateline, NY_TIME_ZONE, SA_TIME_ZONE } from '../utils/time.js'

export const meta = { layout: 'app', title: 'Market Jury' }

// The Overview. For now it carries the status bar and says the experiment has
// not started; the value chart, standings and last run arrive with later milestones.
function OverviewPage() {
  useMeta({ title: 'Market Jury' })

  // Keep a number in reactive state: arrow-js proxies objects, and a proxied Date breaks Intl.
  const clock = reactive({ now: Date.now() })
  const timer = setInterval(() => { clock.now = Date.now() }, 15_000)
  try { onCleanup(() => clearInterval(timer)) } catch {}

  return html`
    <div class="space-y-6">
      <header class="flex flex-col gap-1.5 border-b border-line pb-3">
        <h1 class="font-display text-4xl font-bold tracking-tight text-fg sm:text-5xl">Market Jury</h1>
        <p class="prompt prompt-caret">4 AI traders | 1 market | you are the jury</p>
        <div class="prompt flex flex-wrap gap-x-4 gap-y-1" data-testid="dateline">
          <span>${() => formatDateline(new Date(clock.now), SA_TIME_ZONE)}</span>
          <span>NY ${() => formatClock(new Date(clock.now), NY_TIME_ZONE)} · SAST ${() => formatClock(new Date(clock.now), SA_TIME_ZONE)}</span>
        </div>
      </header>

      <section class="rounded-panel border border-line bg-surface-raised p-4 shadow-panel">
        <p class="prompt prompt-caret">Status</p>
        <h2 class="mt-2 font-display text-2xl font-semibold text-fg">The experiment has not started yet</h2>
        <p class="mt-2 max-w-prose text-fg-soft">
          Four AI Traders will each get $1,000 of virtual money and decide every evening what to buy and sell.
          Their portfolios, trades and reasons will show up here once the first trading day has run.
        </p>
      </section>
    </div>
  `
}

export default OverviewPage
