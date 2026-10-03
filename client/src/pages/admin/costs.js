import { html } from '@arrow-js/core'
import { useMeta } from '../../framework/index.js'
import { useFetch } from '../../composables/useFetch.js'
import { Banner } from '../../components/Banner.js'
import { Loadable } from '../../components/Loadable.js'
import { PageHeader } from '../../components/PageHeader.js'
import { usd } from '../../utils/format.js'

export const meta = { layout: 'app', title: 'Costs · Market Jury' }

const th = 'px-2 py-2 text-left font-mono text-xs font-medium uppercase tracking-wide text-fg-soft'
const td = 'border-t border-line px-2 py-2.5 text-right font-mono text-sm text-fg'
const PROVIDERS = /** @type {Record<string, string>} */ ({ anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', deepseek: 'DeepSeek' })

/** @param {number} n */
const dollars = (n) => `$${n.toFixed(2)}`

/** "October" from "2026-10" (the budget runs by calendar month, UTC). @param {string} month */
const monthName = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })

// Costs: are we inside the budget? The meter (design system BudgetMeter): solid bar =
// spent so far, hatched extension = projected for the month, full track = the budget.
function CostsPage() {
  useMeta({ title: 'Costs · Market Jury' })
  const costs = useFetch('/api/admin/costs')
  return html`
    <div class="flex flex-col gap-6">
      ${PageHeader({ eyebrow: 'Trade Master only', title: 'Costs', intro: 'What the AI models have cost this month, and where the month is heading at this pace. Dry runs count too.' })}
      ${Loadable(costs, (c) => {
        const b = c.budget
        /** Share of the monthly budget, 0 to 100. @param {number} usd */
        const pct = (usd) => (b.ceilingUsd ? Math.min(100, (usd / b.ceilingUsd) * 100) : 0).toFixed(1)
        const month = monthName(b.month)
        const short = month.slice(0, 3)
        const caption = `${month}: ${dollars(b.spentUsd)} spent, ${dollars(b.projectedUsd)} projected of ${dollars(b.ceilingUsd)} (${Math.round(b.ceilingUsd ? (b.projectedUsd / b.ceilingUsd) * 100 : 0)}%)`
        return html`
          ${b.level !== 'ok' ? Banner(b.level === 'over'
            ? 'The projected spend has reached the budget ceiling. The weekly Traders and the daily recap are paused; the daily Traders and the weekly report keep running.'
            : 'The projected spend is over 90% of the budget. At 100% the weekly Traders and the daily recap pause.') : ''}
          <dl class="grid grid-cols-3 gap-3">
            ${[[`Spent so far in ${month}`, b.spentUsd, `since 1 ${short}`], [`Projected for all of ${month}`, b.projectedUsd, "at today's pace"], ['Monthly budget', b.ceilingUsd, 'set in Settings']].map(([label, value, hint]) => html`<div class="rounded-panel border border-line bg-surface-raised p-3"><dt class="prompt">${label}</dt><dd class="font-mono text-lg text-fg">${dollars(Number(value))}</dd><dd class="text-xs text-fg-soft">${hint}</dd></div>`)}
          </dl>
          <div class="${`mj-meter${b.level === 'ok' ? '' : ' mj-meter--warn'}`}" role="img" aria-label="${caption}">
            <p class="font-mono text-sm text-fg" aria-hidden="true">${caption}</p>
            <div class="mj-meter__track" aria-hidden="true">
              <div class="mj-meter__projected" style="${`width: ${pct(b.projectedUsd)}%`}"></div>
              <div class="mj-meter__spent" style="${`width: ${pct(b.spentUsd)}%`}"></div>
              <div class="mj-meter__tick"></div>
            </div>
            <p class="mj-meter__scale" aria-hidden="true"><span>$0</span><span>Warning at 90%</span><span>${dollars(b.ceilingUsd)}</span></p>
          </div>
          <section class="flex flex-col gap-2"><h2 class="font-display text-2xl font-semibold text-fg">By provider</h2>
            ${c.byProvider.length ? html`<table class="w-full border-collapse"><tbody>${c.byProvider.map((/** @type {any} */ p) => html`<tr><th scope="row" class="border-t border-line px-2 py-2.5 text-left text-sm font-normal text-fg">${PROVIDERS[p.provider] ?? p.provider}</th><td class="${td}">${usd(p.cost_micro)}</td></tr>`)}</tbody></table>` : html`<p class="text-fg-soft">No model calls this month yet.</p>`}
          </section>
          <section class="flex flex-col gap-2"><h2 class="font-display text-2xl font-semibold text-fg">By Trader</h2>
            ${c.byTrader.length ? html`<div class="-mx-4 overflow-x-auto px-4"><table class="w-full min-w-max border-collapse">
              <thead><tr><th scope="col" class="${th}">Who</th><th scope="col" class="${th}">Model</th><th scope="col" class="${`${th} text-right`}">Calls</th><th scope="col" class="${`${th} text-right`}">Tokens in</th><th scope="col" class="${`${th} text-right`}">Tokens out</th><th scope="col" class="${`${th} text-right`}">Cost</th></tr></thead>
              <tbody>${c.byTrader.map((/** @type {any} */ r) => html`<tr>
                <td class="border-t border-line px-2 py-2.5 text-sm text-fg">${r.name}</td>
                <td class="border-t border-line px-2 py-2.5 font-mono text-xs text-fg-soft">${r.model_version}</td>
                <td class="${td}">${r.calls}</td><td class="${td}">${Number(r.tokens_in).toLocaleString('en-US')}</td><td class="${td}">${Number(r.tokens_out).toLocaleString('en-US')}</td><td class="${td}">${usd(r.cost_micro)}</td>
              </tr>`)}</tbody></table></div>` : html`<p class="text-fg-soft">No model calls this month yet.</p>`}
          </section>
        `
      })}
    </div>
  `
}

export default CostsPage
