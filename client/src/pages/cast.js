import { html } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { PageHeader } from '../components/PageHeader.js'
import { TraderMark } from '../components/TraderMark.js'

export const meta = { layout: 'app', title: 'The cast · Market Jury' }

// Line icons from the design's cast board, drawn in the text colour. Each is a
// whole <svg>: shapes parsed on their own would not land in the SVG namespace.
const ICONS = /** @type {Record<string, any>} */ ({
  tradeMaster: () => html`<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" class="text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(-40 24 18)"><rect x="13" y="10" width="22" height="10" rx="1.5"/><line x1="24" y1="20" x2="24" y2="36"/></g><line x1="8" y1="41" x2="34" y2="41"/><rect x="12" y="35" width="18" height="6"/></g></svg>`,
  floorRunner: () => html`<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" class="text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h16l6 6v22H18z"/><path d="M34 10v6h6"/><line x1="23" y1="22" x2="35" y2="22"/><line x1="23" y1="28" x2="35" y2="28"/><line x1="23" y1="34" x2="30" y2="34"/><line x1="4" y1="18" x2="12" y2="18"/><line x1="7" y1="25" x2="13" y2="25"/><line x1="4" y1="32" x2="12" y2="32"/></g></svg>`,
  complianceDesk: () => html`<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" class="text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="10" r="5"/><path d="M21 15h6l2 9H19z"/><rect x="10" y="24" width="28" height="8"/><path d="M15 40l5 4 13-8"/></g></svg>`,
  openingBell: () => html`<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" class="text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 34c0-13 4-21 11-21s11 8 11 21l3 3H10z"/><line x1="24" y1="7" x2="24" y2="13"/><circle cx="24" cy="41" r="2.5"/><path d="M5 18c1-4 3-7 6-9M43 18c-1-4-3-7-6-9"/></g></svg>`,
  index: () => html`<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" class="text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8v32h34"/><path d="M12 34l28-16" stroke-dasharray="5 4"/></g></svg>`,
  columnist: () => html`<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" class="text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M24 43L13 25l5-15h12l5 15z"/><line x1="24" y1="43" x2="24" y2="27"/><circle cx="24" cy="24" r="2.5"/><line x1="17" y1="10" x2="31" y2="10"/></g></svg>`,
  gallery: () => html`<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" class="text-fg"><g stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 14h32M8 24h32M8 34h32"/><path d="M12 14v-3M20 14v-3M28 14v-3M36 14v-3M12 24v-3M20 24v-3M28 24v-3M36 24v-3M12 34v-3M20 34v-3M28 34v-3M36 34v-3"/><path d="M6 40h36"/></g></svg>`,
})

const CAST = [
  { icon: 'tradeMaster', name: 'Trade Master', text: 'Cas. Sets up Traders, rules and budget. The only one who can change anything.' },
  { icon: 'floorRunner', name: 'Floor Runner', text: 'Gathers prices and headlines after the close into the briefing pack.' },
  { icon: 'complianceDesk', name: 'Compliance Desk', text: 'Checks every order against the rules, trimming or rejecting any that break them.' },
  { icon: 'openingBell', name: 'Opening Bell', text: "Fills queued orders at the next day's opening price. Sells first, then buys." },
  { icon: 'index', name: 'The Index', text: 'The do-nothing benchmark: buys SPY on day one and holds. Always the grey dashed line.' },
  { icon: 'columnist', name: 'Market Columnist', text: 'Writes the daily recap and weekly report. Watches, explains, never trades.' },
  { icon: 'gallery', name: 'Gallery', text: 'The public, once Cas switches it on. Reads everything, changes nothing.' },
]

const MODELS = [{ name: 'Claude', colourSlot: 1 }, { name: 'GPT', colourSlot: 2 }, { name: 'Gemini', colourSlot: 3 }, { name: 'DeepSeek', colourSlot: 4 }]

const card = 'flex flex-col gap-2.5 border-t-2 border-line-strong pt-4'

// The cast: who does what in the experiment, from the design's cast board.
function CastPage() {
  useMeta({ title: 'The cast · Market Jury' })
  return html`
    <div class="flex flex-col gap-8">
      ${PageHeader({ eyebrow: 'Market Jury · who does what', title: 'The cast', intro: 'Four AI models trade virtual money. Everyone else here is plain code with a job title.' })}
      <ul class="grid gap-x-9 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        ${CAST.map((c) => html`<li class="${card}">
          ${ICONS[c.icon]()}
          <h2 class="font-display text-2xl font-semibold text-fg">${c.name}</h2>
          <p class="text-[15px] leading-relaxed text-fg-soft">${c.text}</p>
        </li>`)}
        <li class="${card}">
          <h2 class="font-display text-2xl font-semibold text-fg">The Traders</h2>
          <p class="text-[15px] leading-relaxed text-fg-soft">Eight AI agents, two per model. Each colour is theirs for life.</p>
          <ul class="grid grid-cols-2 gap-3">
            ${MODELS.map((m) => html`<li class="flex items-center gap-2.5">${TraderMark({ ...m, kind: 'ai' }, { size: 'lg' })}<span class="flex flex-col"><span class="font-semibold text-fg">${m.name}</span><span class="prompt">Daily + Weekly</span></span></li>`)}
          </ul>
        </li>
      </ul>
    </div>
  `
}

export default CastPage
