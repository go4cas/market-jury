import { html, svg } from '@arrow-js/core'
import { usd } from '../utils/format.js'
import { colourOf, modelName } from '../utils/traders.js'

const btn = 'inline-flex min-h-[52px] items-center justify-center rounded-control px-6 font-mono text-[15px] font-semibold'

/**
 * @typedef {object} HeroData
 * @property {number} traders active AI Traders (retired ones drop out)
 * @property {number} startingCashMicro the smallest starting cash among them
 * @property {boolean} cashVaries Traders started with different amounts
 * @property {number} trades
 * @property {Array<{ id: number, name: string, kind: string, colourSlot: number | null, totalMicro: number }>} daily
 */

/** "$1,000" without cents. @param {number} micro */
const dollars = (micro) => usd(micro, { whole: true })

/**
 * One ticker item: a value in fg and the words around it in fg-soft, never wrapping inside.
 * @param {string} before @param {string} value @param {string} [after]
 */
const item = (before, value, after = '') => html`<span class="whitespace-nowrap">${before}<span class="font-semibold text-fg">${value}</span>${after}</span>`

/**
 * The live ticker under the headline. Every number comes from the experiment as it
 * stands, so it stays true if Traders are added or retired or the run stops early.
 * @param {HeroData} hero @param {string} state @param {number} day
 */
function tickerItems(hero, state, day) {
  const items = [
    item('', String(hero.traders), ' AI Traders'),
    hero.cashVaries ? item('from ', dollars(hero.startingCashMicro)) : item('', dollars(hero.startingCashMicro), ' each'),
  ]
  if (state === 'setup') items.push(item('', 'Starting soon'))
  else if (state === 'running') items.push(item('Day ', String(day)), item('', String(hero.trades), ' trades so far'))
  else items.push(item(state === 'ended' ? 'Ended after day ' : 'Paused after day ', String(day)), item('', String(hero.trades), ' trades'))
  return items
}

// The top of the home page: what this is, in one look, for someone arriving from
// a blog post. The Overview follows underneath on the same page. No fixed counts,
// amounts or durations in the copy: those live in the ticker, from live data.
/**
 * @param {{ hero: HeroData, state: string, day: number, onAhead: () => void, onCast: (e: Event) => void }} props
 */
export function LandingHero({ hero, state, day, onAhead, onCast }) {
  const items = tickerItems(hero, state, day)
  return html`<section class="grid items-center gap-6 border-b border-line pb-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-12 md:pb-10" aria-labelledby="hero-title">
    <div class="flex flex-col gap-5">
      <p class="prompt prompt-caret">A paper-trading experiment</p>
      <h1 id="hero-title" class="font-display text-[40px] font-bold leading-[44px] tracking-tight text-balance text-fg md:text-[64px] md:leading-[68px]">Rival AIs. Same money, same news. Different trades.</h1>
      <p class="font-mono text-lg leading-7 text-fg-soft" data-testid="hero-ticker"><span class="text-brand" aria-hidden="true">&gt; </span>${items.map((it, i) => html`${i ? ' · ' : ''}${it}`)}</p>
      <p class="max-w-[34em] text-lg leading-7 text-fg-soft">Every evening each AI model decides what to buy and sell on the US stock market with virtual money. You watch how each one behaves and decide which deserves real money.</p>
      <div class="flex flex-wrap gap-3">
        <button type="button" class="${`${btn} bg-brand text-on-brand hover:bg-brand-hover`}" @click="${onAhead}">See who is ahead</button>
        <a href="/cast" class="${`${btn} border border-line-strong text-fg hover:bg-surface-inset`}" @click="${onCast}">Meet the cast</a>
      </div>
    </div>
    ${JuryBox(hero)}
  </section>`
}

/**
 * The jury box, live: one bar per daily Trader at its latest value on a 90% to
 * 115% of starting cash scale, each wired to the steel-blue node, with The Index
 * as a dashed rule across them.
 * @param {HeroData} hero
 */
export function JuryBox(hero) {
  const traders = hero.daily.filter((t) => t.kind !== 'benchmark')
  const index = hero.daily.find((t) => t.kind === 'benchmark')
  const start = hero.startingCashMicro || 1
  const base = 300
  /** Bar height for a value: 40px at 90% of starting cash, 240px at 115%. @param {number} v */
  const height = (v) => 40 + Math.min(1, Math.max(0, (v / start - 0.9) / 0.25)) * 200
  const left = 40
  const right = left + traders.length * 90 - 30
  const node = { x: (left + right) / 2, y: 40 }
  const width = right + 130
  const bars = traders.map((t, i) => ({ t, x: left + i * 90, top: base - height(t.totalMicro) }))
  const label = `Daily Traders now: ${traders.map((t) => `${modelName(t.name)} ${dollars(t.totalMicro)}`).join(', ')}${index ? `; The Index ${dollars(index.totalMicro)}` : ''}`
  const indexY = index ? base - height(index.totalMicro) : 0
  return svg`<svg viewBox="${`0 0 ${width} 340`}" width="100%" class="max-h-[204px] md:max-h-none" role="img" aria-label="${label}" data-testid="jury-box">
    ${bars.map((b) => svg`<line x1="${b.x + 30}" y1="${b.top}" x2="${node.x}" y2="${node.y}" style="stroke: var(--color-fg); stroke-width: 1.5; stroke-opacity: 0.45"></line>`)}
    ${bars.map((b) => svg`<rect x="${b.x}" y="${b.top}" width="60" height="${base - b.top}" style="${`fill: ${colourOf(b.t)}`}"></rect>
      <circle cx="${b.x + 30}" cy="${b.top}" r="9" style="${`fill: ${colourOf(b.t)}`}"></circle>
      <text x="${b.x + 30}" y="${b.top - 18}" text-anchor="middle" style="fill: var(--color-fg); font: 600 14px var(--font-mono)">${dollars(b.t.totalMicro)}</text>
      <text x="${b.x + 30}" y="326" text-anchor="middle" style="fill: var(--color-fg-soft); font: 500 12px var(--font-mono)">${modelName(b.t.name).toUpperCase()}</text>`)}
    ${index ? svg`<line x1="24" x2="${right + 16}" y1="${indexY}" y2="${indexY}" style="stroke: var(--color-index); stroke-width: 2; stroke-dasharray: 6 5"></line>
      <text x="${right + 24}" y="${indexY + 4}" style="fill: var(--color-index); font: 500 12px var(--font-mono)">THE INDEX</text>
      <text x="${right + 24}" y="${indexY + 20}" style="fill: var(--color-index); font: 500 12px var(--font-mono)">${dollars(index.totalMicro)}</text>` : ''}
    <circle cx="${node.x}" cy="${node.y}" r="14" style="fill: var(--color-brand)"></circle>
    <rect x="24" y="${base}" width="${right - 8}" height="6" style="fill: var(--color-fg)"></rect>
  </svg>`
}
