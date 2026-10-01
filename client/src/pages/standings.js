import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useApi } from '../composables/useApi.js'
import { Loadable } from '../components/Loadable.js'
import { PageHeader } from '../components/PageHeader.js'
import { Segmented } from '../components/Segmented.js'
import { Badges, StandingsTable } from '../components/StandingsTable.js'
import { Term } from '../components/Term.js'
import { day, dayRange, monthName } from '../utils/format.js'
import { queryParam } from '../utils/nav.js'

export const meta = { layout: 'app', title: 'Standings · Market Jury' }

const PERIODS = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'all', label: 'Since start' }]
const RETURN_LABEL = /** @type {Record<string, string>} */ ({ day: 'Day', week: 'Week', month: 'Month', all: 'Since start' })

// Standings: who is ahead, and how did they get there?
function StandingsPage() {
  useMeta({ title: 'Standings · Market Jury' })
  const kind = queryParam('kind') ?? ''
  const ui = reactive({
    track: queryParam('track') === 'weekly' ? 'weekly' : 'daily',
    kind: PERIODS.some((p) => p.value === kind) ? kind : 'week',
    end: /^\d{4}-\d{2}-\d{2}$/.test(queryParam('end') ?? '') ? String(queryParam('end')) : '',
  })
  const request = useApi(() => `/api/standings?track=${ui.track}&kind=${ui.kind}${ui.end ? `&end=${ui.end}` : ''}`)

  return html`
    <div class="flex flex-col gap-6">
      ${PageHeader({
        eyebrow: 'Ranked by return',
        title: 'Standings',
        intro: html`Who is ahead over a day, a week, a month or since the start. Each row also shows how the Trader got there: its ${Term('worst drop')}, how much it keeps in ${Term('cash')}, and how often it traded or broke a rule.`,
      })}
      <div class="flex flex-col gap-3">
        ${Segmented({ label: 'Track', options: [{ value: 'daily', label: 'Daily track' }, { value: 'weekly', label: 'Weekly track' }], value: () => ui.track, onPick: (v) => { ui.track = v } })}
        ${Segmented({ label: 'Period', options: PERIODS, value: () => ui.kind, onPick: (v) => { ui.kind = v; ui.end = '' } })}
      </div>
      ${Loadable(request, (s) => html`
        ${PeriodPicker(s, ui)}
        <h2 class="font-display text-2xl font-semibold text-fg">${heading(s)}</h2>
        ${StandingsTable({ rows: s.rows, returnLabel: RETURN_LABEL[s.kind] })}
        ${s.badges.length ? html`<section class="flex flex-col gap-2"><h3 class="prompt">${s.kind === 'week' ? 'Badges this week' : 'Badges this month'}</h3>${Badges(s.badges)}</section>` : ''}
      `)}
    </div>
  `
}

/** @param {any} s */
function heading(s) {
  if (!s.end) return 'No closing values yet'
  if (s.kind === 'day') return day(s.end)
  if (s.kind === 'week') return `Week of ${dayRange(s.start, s.end)}`
  if (s.kind === 'month') return monthName(s.end)
  return `Since the start, to ${day(s.end)}`
}

/**
 * Pick a past week or month.
 * @param {any} s
 * @param {{ kind: string, end: string }} ui
 */
function PeriodPicker(s, ui) {
  const ends = s.kind === 'week' ? s.periods.weeks : s.kind === 'month' ? s.periods.months : []
  if (ends.length < 2) return ''
  return html`<label class="flex flex-col gap-1.5 sm:max-w-xs">
    <span class="prompt">${s.kind === 'week' ? 'Pick a week' : 'Pick a month'}</span>
    <select class="min-h-11 rounded-control border border-line-strong bg-surface-inset px-3 font-mono text-sm text-fg" @change="${/** @param {Event} e */ (e) => { ui.end = /** @type {HTMLSelectElement} */ (e.target).value }}">
      ${ends.map((/** @type {string} */ end) => html`<option value="${end}" selected="${end === s.end ? true : false}">${s.kind === 'week' ? `Week ending ${day(end)}` : monthName(end)}</option>`)}
    </select>
  </label>`
}

export default StandingsPage
