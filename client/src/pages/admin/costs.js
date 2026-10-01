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

// Costs: are we inside the budget?
function CostsPage() {
  useMeta({ title: 'Costs · Market Jury' })
  const costs = useFetch('/api/admin/costs')
  return html`
    <div class="flex flex-col gap-6">
      ${PageHeader({ eyebrow: 'Trade Master only', title: 'Costs', intro: 'What the AI models have cost this month, and where the month is heading at this pace. Dry runs count too.' })}
      ${Loadable(costs, (c) => {
        const b = c.budget
        const used = b.ceilingUsd ? Math.min(100, (b.projectedUsd / b.ceilingUsd) * 100) : 0
        return html`
          ${b.level !== 'ok' ? Banner(b.level === 'over'
            ? 'The projected spend has reached the budget ceiling. The weekly Traders and the daily recap are paused; the daily Traders and the weekly report keep running.'
            : 'The projected spend is over 90% of the budget. At 100% the weekly Traders and the daily recap pause.') : ''}
          <dl class="grid grid-cols-3 gap-3">
            <div class="rounded-panel border border-line bg-surface-raised p-3"><dt class="prompt">Spent in ${b.month}</dt><dd class="font-mono text-lg text-fg">${dollars(b.spentUsd)}</dd></div>
            <div class="rounded-panel border border-line bg-surface-raised p-3"><dt class="prompt">Projected</dt><dd class="font-mono text-lg text-fg">${dollars(b.projectedUsd)}</dd></div>
            <div class="rounded-panel border border-line bg-surface-raised p-3"><dt class="prompt">Budget</dt><dd class="font-mono text-lg text-fg">${dollars(b.ceilingUsd)}</dd></div>
          </dl>
          <svg viewBox="0 0 100 6" preserveAspectRatio="none" class="h-3 w-full" role="img" aria-label="${`Projected spend is ${Math.round(used)}% of the budget`}">
            <rect x="0" y="0" width="100" height="6" fill="var(--color-surface-inset)"></rect>
            <rect x="0" y="0" width="${used.toFixed(1)}" height="6" fill="${b.level === 'ok' ? 'var(--color-brand)' : 'var(--color-warn)'}"></rect>
            <rect x="89.8" y="0" width="0.4" height="6" fill="var(--color-fg-soft)"></rect>
          </svg>
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
