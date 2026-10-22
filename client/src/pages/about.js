import { html } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { PageHeader } from '../components/PageHeader.js'
import { Loadable } from '../components/Loadable.js'
import { useFetch } from '../composables/useFetch.js'
import { day } from '../utils/format.js'

export const meta = { layout: 'app', title: 'About this site · Market Jury' }

// Where data goes, in plain words: what visitors leave behind, what the AI
// providers are sent, and how long backups are kept. Keep it true to the code
// (server/auth.js cookie, uiState/Disclosure localStorage, agents/ prompts,
// scripts/backup.js KEEP_DAYS) when any of those change.
const SECTIONS = [
  {
    title: 'When you visit',
    items: [
      'There are no ads, no analytics and no tracking.',
      'Fonts and scripts come from this site only, so no other company sees your visit.',
      'Your light or dark choice and which sections you leave open are kept in your own browser, never sent here.',
      'There are no visitor accounts. The only cookie is the Trade Master\'s sign-in, and visitors never get it.',
      'Cloudflare, which carries traffic to this site, and the server itself see your internet address, as every website does.',
    ],
  },
  {
    title: 'What the AI models are sent',
    items: [
      'Each evening the Traders are sent the briefing pack: prices and news headlines that are public anyway.',
      'Each Trader is also sent its own virtual portfolio, its recent decisions and its journal. No personal details are in any of these.',
      'Traders in a track that can search the web choose their own searches, up to a set number each run, so they don\'t all see the same news. The searches go to the model\'s own company, or to DeepSeek when a track shares one search tool. What they find is treated as untrusted reading, like the headlines.',
      'The Market Columnist is sent the Traders\' names, decisions and journals to write its reports.',
      'They go to the companies behind each model in the line-up (Anthropic, OpenAI, Google and DeepSeek in the starting line-up), under their API terms.',
    ],
  },
  {
    title: 'What is kept',
    items: [
      'Every price, decision and trade is kept for good, so the history stays honest.',
      'A copy of the database is backed up each night, and each copy is deleted after 30 days.',
    ],
  },
]

const PULL = 'https://github.com/go4cas/market-jury/pull/'

/**
 * The change log, newest first: date and area on the first line on a phone,
 * the summary and its pull request wrapping under them.
 * @param {{ startDate: string | null, changes: Array<{ effectiveOn: string, area: string, summary: string, prNumber: number | null }> }} r
 */
function Changes(r) {
  if (!r.changes.length) return html`<p class="text-[15px] text-fg-soft">${r.startDate ? `No changes since the experiment started on ${day(r.startDate)}` : 'No changes yet.'}</p>`
  return html`<ul class="mj-changes flex flex-col" aria-label="Changes, newest first">${r.changes.map((c) => html`<li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line py-2.5">
    <span class="whitespace-nowrap font-mono text-sm text-fg">${day(c.effectiveOn)}</span>
    <span class="rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-xs text-fg">${c.area}</span>
    <p class="basis-full text-[15px] text-fg sm:flex-1 sm:basis-auto">${c.summary}${c.prNumber ? html` <a class="font-mono text-sm text-fg-soft underline underline-offset-4 hover:text-fg" href="${`${PULL}${c.prNumber}`}" target="_blank" rel="noopener" aria-label="${`Pull request ${c.prNumber} on GitHub`}">#${c.prNumber}</a>` : ''}</p>
  </li>`)}</ul>`
}

// About this site: a short note on where data goes, linked from every footer,
// and the change log of what the Traders are given.
function AboutPage() {
  useMeta({ title: 'About this site · Market Jury' })
  const changes = useFetch('/api/changes')
  return html`
    <div class="flex max-w-prose flex-col gap-6">
      ${PageHeader({ eyebrow: 'About this site', title: 'Where data goes', intro: 'Market Jury is a paper-trading experiment with virtual money. It collects nothing about you, and this is everything that leaves the site.' })}
      ${SECTIONS.map((s) => html`<section class="flex flex-col gap-2">
        <h2 class="font-display text-2xl font-semibold text-fg">${s.title}</h2>
        <ul class="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-fg">${s.items.map((i) => html`<li>${i}</li>`)}</ul>
      </section>`)}
      <section class="flex flex-col gap-2">
        <h2 class="font-display text-2xl font-semibold text-fg">Changes to what the Traders see</h2>
        <p class="text-[15px] leading-relaxed text-fg-soft">Anything that changes what the Traders are given or how their orders are judged is listed here, from the first trading day it applied.</p>
        ${Loadable(changes, Changes)}
      </section>
    </div>
  `
}

export default AboutPage
