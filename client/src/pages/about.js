import { html } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { PageHeader } from '../components/PageHeader.js'

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

// About this site: a short note on where data goes, linked from every footer.
function AboutPage() {
  useMeta({ title: 'About this site · Market Jury' })
  return html`
    <div class="flex max-w-prose flex-col gap-6">
      ${PageHeader({ eyebrow: 'About this site', title: 'Where data goes', intro: 'Market Jury is a paper-trading experiment with virtual money. It collects nothing about you, and this is everything that leaves the site.' })}
      ${SECTIONS.map((s) => html`<section class="flex flex-col gap-2">
        <h2 class="font-display text-2xl font-semibold text-fg">${s.title}</h2>
        <ul class="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-fg">${s.items.map((i) => html`<li>${i}</li>`)}</ul>
      </section>`)}
    </div>
  `
}

export default AboutPage
