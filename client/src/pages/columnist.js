import { html, reactive } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useApi } from '../composables/useApi.js'
import { Loadable } from '../components/Loadable.js'
import { PageHeader } from '../components/PageHeader.js'
import { Segmented } from '../components/Segmented.js'
import { day } from '../utils/format.js'

export const meta = { layout: 'app', title: 'The Columnist · Market Jury' }

// Columnist: what does the observer think? Daily recaps and weekly reports, newest first.
function ColumnistPage() {
  useMeta({ title: 'The Columnist · Market Jury' })
  const ui = reactive({ kind: 'all', before: '' })
  /** @type {any[]} */
  const earlier = reactive([])
  const request = useApi(() => `/api/columnist?${ui.kind === 'all' ? '' : `kind=${ui.kind}&`}${ui.before ? `before=${ui.before}` : ''}`)

  return html`
    <div class="flex flex-col gap-6">
      ${PageHeader({ eyebrow: 'Watches, explains, never trades', title: 'The Market Columnist', intro: 'A short recap after every evening run, explaining one trading idea in plain words, and a longer report at the end of each week. The Traders never see these.' })}
      ${Segmented({ label: 'Show', options: [{ value: 'all', label: 'All' }, { value: 'daily', label: 'Daily recaps' }, { value: 'weekly', label: 'Weekly reports' }], value: () => ui.kind, onPick: (v) => { earlier.length = 0; ui.before = ''; ui.kind = v } })}
      ${Loadable(request, (r) => {
        const posts = [...earlier, ...r.posts]
        if (!posts.length) return html`<p class="text-fg-soft">Nothing written yet. The first recap appears after the first evening run.</p>`
        const more = () => { earlier.push(...r.posts); ui.before = r.nextCursor }
        return html`${posts.map((p) => Post(p).key(`${p.kind}-${p.date}`))}
          ${r.nextCursor ? html`<button type="button" class="inline-flex min-h-11 items-center self-start font-mono text-sm text-brand underline underline-offset-4" @click="${more}">Show earlier posts</button>` : ''}`
      })}
    </div>
  `
}

/** @param {{ kind: string, date: string, headline: string, body: string }} p */
function Post(p) {
  return html`<article class="flex flex-col gap-2 rounded-panel border border-line bg-surface-raised p-4" data-testid="column">
    <p class="prompt">${p.kind === 'weekly' ? 'Weekly report' : 'Daily recap'} · ${day(p.date)}</p>
    <h2 class="font-display text-2xl font-semibold leading-7 text-fg">${p.headline}</h2>
    ${p.body.split(/\n\s*\n/).map((para) => html`<p class="max-w-prose text-[15px] leading-relaxed text-fg">${para}</p>`)}
  </article>`
}

export default ColumnistPage
