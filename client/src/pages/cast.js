import { html } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useFetch } from '../composables/useFetch.js'
import { Loadable } from '../components/Loadable.js'
import { PageHeader } from '../components/PageHeader.js'
import { TraderMark } from '../components/TraderMark.js'
import { displayName } from '../utils/traders.js'
import { navigate } from '../utils/nav.js'

export const meta = { layout: 'app', title: 'The cast · Market Jury' }

// Line icons from the design's cast board, drawn in the text colour. Each is a
// whole <svg>: shapes parsed on their own would not land in the SVG namespace.
const ICONS = /** @type {Record<string, () => any>} */ ({
  tradeMaster: () => html`<svg width="32" height="32" viewBox="0 0 48 48" aria-hidden="true" class="shrink-0 text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(-40 24 18)"><rect x="13" y="10" width="22" height="10" rx="1.5"/><line x1="24" y1="20" x2="24" y2="36"/></g><line x1="8" y1="41" x2="34" y2="41"/><rect x="12" y="35" width="18" height="6"/></g></svg>`,
  floorRunner: () => html`<svg width="32" height="32" viewBox="0 0 48 48" aria-hidden="true" class="shrink-0 text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h16l6 6v22H18z"/><path d="M34 10v6h6"/><line x1="23" y1="22" x2="35" y2="22"/><line x1="23" y1="28" x2="35" y2="28"/><line x1="23" y1="34" x2="30" y2="34"/><line x1="4" y1="18" x2="12" y2="18"/><line x1="7" y1="25" x2="13" y2="25"/><line x1="4" y1="32" x2="12" y2="32"/></g></svg>`,
  complianceDesk: () => html`<svg width="32" height="32" viewBox="0 0 48 48" aria-hidden="true" class="shrink-0 text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="10" r="5"/><path d="M21 15h6l2 9H19z"/><rect x="10" y="24" width="28" height="8"/><path d="M15 40l5 4 13-8"/></g></svg>`,
  openingBell: () => html`<svg width="32" height="32" viewBox="0 0 48 48" aria-hidden="true" class="shrink-0 text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 34c0-13 4-21 11-21s11 8 11 21l3 3H10z"/><line x1="24" y1="7" x2="24" y2="13"/><circle cx="24" cy="41" r="2.5"/><path d="M5 18c1-4 3-7 6-9M43 18c-1-4-3-7-6-9"/></g></svg>`,
  index: () => html`<svg width="32" height="32" viewBox="0 0 48 48" aria-hidden="true" class="shrink-0 text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8v32h34"/><path d="M12 34l28-16" stroke-dasharray="5 4"/></g></svg>`,
  columnist: () => html`<svg width="32" height="32" viewBox="0 0 48 48" aria-hidden="true" class="shrink-0 text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M24 43L13 25l5-15h12l5 15z"/><line x1="24" y1="43" x2="24" y2="27"/><circle cx="24" cy="24" r="2.5"/><line x1="17" y1="10" x2="31" y2="10"/></g></svg>`,
  gallery: () => html`<svg width="32" height="32" viewBox="0 0 48 48" aria-hidden="true" class="shrink-0 text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 14h32M8 24h32M8 34h32"/><path d="M12 14v-3M20 14v-3M28 14v-3M36 14v-3M12 24v-3M20 24v-3M28 24v-3M36 24v-3M12 34v-3M20 34v-3M28 34v-3M36 34v-3"/><path d="M6 40h36"/></g></svg>`,
})

// Who's who, in three fixed rows: The Traders, then the daily cycle in the order
// it runs, then the rest of the experiment. Each card has an id so persona names
// elsewhere can link to it (/cast#compliance-desk).
const CYCLE = [
  { id: 'floor-runner', icon: 'floorRunner', name: 'Floor Runner', text: 'Gathers prices and headlines after the close into the briefing pack.', when: 'every trading day after the close' },
  { id: 'compliance-desk', icon: 'complianceDesk', name: 'Compliance Desk', text: 'Checks every order against the rules, trimming or rejecting any that break them.', when: 'after the Traders decide' },
  { id: 'opening-bell', icon: 'openingBell', name: 'Opening Bell', text: "Fills queued orders at the next day's opening price. Sells first, then buys.", when: 'at the New York open' },
  { id: 'market-columnist', icon: 'columnist', name: 'Market Columnist', text: 'Writes the daily recap and weekly report. Watches, explains, never trades.', when: 'after each evening run, and at the end of the week' },
]
const AROUND = [
  { id: 'the-index', icon: 'index', name: 'The Index', text: 'The do-nothing benchmark: buys SPY on day one and holds. Always the grey dashed line.', when: 'buys once, on day one' },
  { id: 'trade-master', icon: 'tradeMaster', name: 'Trade Master', text: 'Cas. Sets up Traders, rules and budget. The only one who can change anything.', when: 'whenever Cas changes a setting' },
  { id: 'gallery', icon: 'gallery', name: 'Gallery', text: 'The public, once Cas switches it on. Reads everything, changes nothing.', when: 'once Cas opens it' },
]

// Before the line-up is seeded there are no Traders yet: show the models it starts with.
const MODELS = [{ name: 'Claude', colourSlot: 1 }, { name: 'GPT', colourSlot: 2 }, { name: 'Gemini', colourSlot: 3 }, { name: 'DeepSeek', colourSlot: 4 }]

const card = 'flex h-full scroll-mt-4 flex-col gap-3 rounded-panel border border-line bg-surface-raised p-4 shadow-panel'
const title = 'font-display text-2xl font-semibold text-fg'
const text = 'text-[15px] leading-[22px] text-fg-soft'
const rowTitle = 'font-display text-[28px] font-semibold leading-8 text-fg'
const when = 'prompt mt-auto'

/**
 * One persona's card; the daily cycle's cards carry their step number.
 * @param {{ id: string, icon: string, name: string, text: string, when: string }} c
 * @param {number} [step]
 */
const Card = (c, step) => html`<article id="${c.id}" class="${card}">
  ${step ? html`<p class="font-mono text-xs font-semibold tracking-wide text-brand">Step ${step}</p>` : ''}
  <div class="flex items-center gap-3">${ICONS[c.icon]()}<h3 class="${title}">${c.name}</h3></div>
  <p class="${text}">${c.text}</p>
  <p class="${when}">When · ${c.when}</p>
</article>`

// The cast: who does what in the experiment. Each card has its icon and name on one
// line. Three rows, cards in a row the same
// height with the "When" line at the bottom; two columns on a tablet, one on a phone.
function CastPage() {
  useMeta({ title: 'The cast · Market Jury' })
  const traders = useFetch('/api/traders')
  return html`
    <div class="flex flex-col gap-8">
      ${PageHeader({ eyebrow: 'Market Jury · who does what', title: 'The cast', intro: 'AI models trade virtual money. Everyone else here is plain code with a job title.' })}
      <article id="traders" class="${card}">
        <h2 class="${title}">The Traders</h2>
        <p class="${text}">Each Trader is one AI model with its own virtual money, deciding every evening or once a week. Each colour is theirs for life.</p>
        ${Loadable(traders, (r) => TraderList(r.traders.filter((/** @type {any} */ t) => t.kind === 'ai')))}
        <p class="${when}">When · every trading day after the close</p>
      </article>
      <section class="flex flex-col gap-4" aria-labelledby="daily-cycle">
        <h2 id="daily-cycle" class="${rowTitle}">The daily cycle</h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">${CYCLE.map((c, i) => Card(c, i + 1))}</div>
      </section>
      <section class="flex flex-col gap-4" aria-labelledby="around">
        <h2 id="around" class="${rowTitle}">Around the experiment</h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${AROUND.map((c) => Card(c))}</div>
      </section>
    </div>
  `
}

/** @param {any[]} traders */
function TraderList(traders) {
  if (!traders.length) {
    return html`<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">${MODELS.map((m) => html`<li class="flex items-center gap-2.5">${TraderMark({ ...m, kind: 'ai' })}<span class="flex flex-col"><span class="font-semibold text-fg">${m.name}</span><span class="prompt">Daily + Weekly</span></span></li>`)}</ul>`
  }
  const ordered = [...traders].sort((a, b) => (a.colourSlot ?? 99) - (b.colourSlot ?? 99) || Number(/weekly/i.test(a.name)) - Number(/weekly/i.test(b.name)) || a.id - b.id)
  return html`<ul class="grid gap-x-4 sm:grid-cols-2 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none lg:grid-rows-2">${ordered.map((t) => html`<li>
    <a href="${`/traders/${t.id}`}" class="${`flex min-h-11 items-center gap-2.5 rounded-control hover:bg-surface-inset ${t.status === 'retired' ? 'opacity-50' : ''}`}" @click="${navigate(`/traders/${t.id}`)}">
      ${TraderMark(t, { size: 'sm' })}
      <span class="flex flex-col leading-tight"><span class="font-semibold text-fg">${displayName(t.name)}</span><span class="font-mono text-xs text-fg-soft">${t.modelVersion ?? ''}${t.status === 'retired' ? ' · retired' : ''}</span></span>
    </a>
  </li>`.key(t.id))}</ul>`
}

export default CastPage
