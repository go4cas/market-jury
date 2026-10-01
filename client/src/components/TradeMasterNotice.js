import { html } from '@arrow-js/core'
import { useFetch } from '../composables/useFetch.js'
import { sessionState } from '../state/sessionState.js'
import { navigate } from '../utils/nav.js'
import { day } from '../utils/format.js'
import { Banner } from './Banner.js'

const STEP_NAMES = /** @type {Record<string, string>} */ ({
  'opening-bell': 'The Opening Bell',
  'floor-runner': 'The Floor Runner',
  'daily-traders': 'The daily Traders',
  'weekly-traders': 'The weekly Traders',
  'daily-recap': 'The Columnist\'s daily recap',
  'weekly-report': 'The Columnist\'s weekly report',
})

/** @param {string} step */
export const stepName = (step) => STEP_NAMES[step] ?? step

// Shown to the Trade Master on every screen: a run that failed, or a budget near its limit.
export function TradeMasterNotice() {
  if (!sessionState.tradeMaster) return ''
  const status = useFetch('/api/admin/status')
  return html`${() => {
    const s = status.data()
    if (!s) return ''
    const notes = []
    if (s.failedSteps.length) {
      const f = s.failedSteps[0]
      notes.push(html`${stepName(f.step)} failed for ${day(f.trading_date)}${s.failedSteps.length > 1 ? ` (and ${s.failedSteps.length - 1} more)` : ''}. ${f.error ?? ''} <a href="/admin/settings" class="font-mono text-brand underline" @click="${navigate('/admin/settings')}">Run it again</a>`)
    }
    if (s.budget.level !== 'ok') {
      notes.push(html`${s.budget.level === 'over' ? 'The month\'s projected spend has reached the budget ceiling, so the weekly Traders and the daily recap are paused.' : 'The month\'s projected spend is over 90% of the budget.'} Projected $${s.budget.projectedUsd.toFixed(2)} of $${s.budget.ceilingUsd.toFixed(2)}. <a href="/admin/costs" class="font-mono text-brand underline" @click="${navigate('/admin/costs')}">See costs</a>`)
    }
    return notes.length ? html`<div class="mb-5 flex flex-col gap-2">${notes.map((n) => Banner(n, { testid: 'trade-master-notice' }))}</div>` : ''
  }}`
}
