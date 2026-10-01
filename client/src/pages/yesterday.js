import { html } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useFetch } from '../composables/useFetch.js'
import { DayView } from '../components/DayView.js'
import { Loadable } from '../components/Loadable.js'

export const meta = { layout: 'app', title: 'Yesterday · Market Jury' }

// Yesterday: what happened in the last run?
function YesterdayPage() {
  useMeta({ title: 'Yesterday · Market Jury' })
  const latest = useFetch('/api/days/latest')
  return html`${Loadable(latest, (d) => DayView(d, { latest: true }))}`
}

export default YesterdayPage
