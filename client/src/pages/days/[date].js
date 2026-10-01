import { html } from '@arrow-js/core'
import { useMeta } from '../../framework/index.js'
import { useApi } from '../../composables/useApi.js'
import { useRoute } from '../../composables/useRoute.js'
import { DayView } from '../../components/DayView.js'
import { Loadable } from '../../components/Loadable.js'
import { day } from '../../utils/format.js'

export const meta = { layout: 'app', title: 'A trading day · Market Jury' }

// Any earlier trading evening, shown the same way as Yesterday.
function DayPage() {
  const date = String(useRoute().params().date ?? '')
  useMeta({ title: `${day(date)} · Market Jury` })
  const request = useApi(() => `/api/days/${encodeURIComponent(date)}`)
  return html`${Loadable(request, (d) => DayView(d, { latest: false }))}`
}

export default DayPage
