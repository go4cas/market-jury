import { html, reactive, onCleanup } from '@arrow-js/core'
import { useMeta } from '../../framework/index.js'
import { useFetch } from '../../composables/useFetch.js'
import { useToast } from '../../composables/useToast.js'
import { Banner } from '../../components/Banner.js'
import { fresh, Loadable } from '../../components/Loadable.js'
import { PageHeader } from '../../components/PageHeader.js'
import { stepName } from '../../components/TradeMasterNotice.js'
import { Term } from '../../components/Term.js'
import { TraderName } from '../../components/TraderMark.js'
import { send } from '../../utils/api.js'
import { day } from '../../utils/format.js'

export const meta = { layout: 'app', title: 'Settings · Market Jury' }

const h2 = 'font-display text-2xl font-semibold text-fg'
const panel = 'flex flex-col gap-3 rounded-panel border border-line bg-surface-raised p-4'
const input = 'mt-1.5 min-h-11 w-full rounded-control border border-line bg-surface-inset px-3 font-mono text-fg outline-none focus:border-brand focus:bg-surface-raised'
// Amounts and percentages are short, so their boxes stay short too.
const number = input.replace('w-full', 'block w-36')
const primary = 'inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-4 font-mono text-sm font-semibold text-on-brand hover:bg-brand-hover'
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong px-4 font-mono text-sm font-semibold text-fg hover:bg-surface-inset'

const STATES = /** @type {Record<string, string>} */ ({ setup: 'Being set up', running: 'Running', paused: 'Paused', ended: 'Ended' })

/** @param {HTMLFormElement} form */
const formValues = (form) => Object.fromEntries(new FormData(form).entries())

// Settings: the Trade Master's controls. Start, pause and rehearse the
// experiment; watch the scheduler; change the rules, the budget and the line-up.
function SettingsPage() {
  useMeta({ title: 'Settings · Market Jury' })
  const toast = useToast()
  const status = useFetch('/api/admin/status')
  const settings = useFetch('/api/admin/settings')
  const traders = useFetch('/api/admin/traders')
  const steps = useFetch('/api/admin/steps')
  const rehearsal = useFetch('/api/admin/dry-run')
  const refresh = () => { status.refetch(); settings.refetch(); traders.refetch(); steps.refetch() }

  // While a dry run is going, check on it every few seconds.
  const poll = setInterval(() => { if (rehearsal.data()?.running) rehearsal.refetch() }, 3000)
  try { onCleanup(() => clearInterval(poll)) } catch {}

  /**
   * @param {'POST' | 'PATCH'} method
   * @param {string} path
   * @param {object} body
   * @param {string} done
   */
  const act = async (method, path, body, done) => {
    const r = await send(method, path, body)
    if (!r.ok) { toast.error(r.error); return false }
    toast.success(done)
    refresh()
    return true
  }

  return html`
    <div class="flex flex-col gap-8">
      ${PageHeader({ eyebrow: 'Trade Master only', title: 'Settings', intro: 'Start or pause the experiment, rehearse it with a dry run, and change the line-up, rules and budget. Nobody else can see this page.' })}

      ${Loadable(status, (s) => html`<section class="${panel}" aria-labelledby="experiment">
        <h2 id="experiment" class="${h2}">The experiment</h2>
        <p class="font-mono text-sm text-fg"><span data-testid="experiment-state">${STATES[s.state] ?? s.state}</span>${s.startDate ? ` · started ${day(s.startDate)}` : ''}</p>
        ${s.missingKeys.length ? Banner(html`These model keys are missing from the server's environment file: <span class="font-mono">${s.missingKeys.join(', ')}</span>. The Traders that need them can't decide until they are added.`) : ''}
        ${s.state === 'setup' ? html`
          <p class="max-w-prose text-[15px] text-fg-soft">Starting gives every Trader its starting cash. The first decisions happen on the evening of ${day(s.firstDecisionDate)}, and the orders fill at the next morning's open. Run a dry run first to check that every model answers.</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="${primary}" @click="${() => { if (confirm('Start the experiment? This can be paused but not undone.')) act('POST', '/api/admin/experiment/start', {}, 'The experiment has started.') }}">Start the experiment</button>
          </div>` : ''}
        ${s.state === 'running' ? html`<div><button type="button" class="${secondary}" @click="${() => act('POST', '/api/admin/experiment/pause', {}, 'Paused. Nothing runs until you resume.')}">Pause</button></div>` : ''}
        ${s.state === 'paused' ? html`<div><button type="button" class="${primary}" @click="${() => act('POST', '/api/admin/experiment/resume', {}, 'Resumed. Waiting orders fill at the next open.')}">Resume</button></div>` : ''}
      </section>`)}

      <section class="${panel}" aria-labelledby="dry-run">
        <h2 id="dry-run" class="${h2}">Dry run</h2>
        <p class="max-w-prose text-[15px] text-fg-soft">Every Trader decides on the latest ${Term('briefing pack')} as if for real, but nothing is queued or filled. It costs the same as one evening's run and takes a few minutes.</p>
        ${() => {
          const r = rehearsal.data()
          return fresh(`${r?.running}-${r?.finishedAt}`, html`
            <div><button type="button" class="${secondary}" aria-disabled="${r?.running ? 'true' : 'false'}" @click="${async () => {
              if (r?.running) return
              const out = await send('POST', '/api/admin/dry-run')
              if (!out.ok) toast.error(out.error)
              rehearsal.refetch()
            }}">${r?.running ? 'Dry run going…' : 'Run a dry run'}</button></div>
            ${r?.error ? Banner(r.error) : ''}
            ${r?.result ? html`<p class="prompt">Briefing pack of ${day(r.result.packDate)}</p><ul class="flex flex-col gap-1.5">${r.result.results.map((/** @type {any} */ x) => html`<li class="text-sm text-fg"><span class="font-semibold">${x.trader}</span>: ${x.ok ? `answered with ${x.verdicts.length} ${x.verdicts.length === 1 ? 'order' : 'orders'}` : html`<span class="text-bad">${x.error}</span>`}</li>`)}</ul>` : ''}
          `)
        }}
      </section>

      ${Loadable(steps, (st) => html`<section class="${panel}" aria-labelledby="scheduler">
        <h2 id="scheduler" class="${h2}">Scheduler</h2>
        <p class="max-w-prose text-[15px] text-fg-soft">Each trading day the Opening Bell fills orders half an hour after the open; after the close the Floor Runner builds the pack, the Traders decide and the Columnist writes. A failed step tries again on its own three times.</p>
        ${st.steps.length ? html`<ul class="flex flex-col">${st.steps.slice(0, 24).map((/** @type {any} */ x) => html`<li class="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm">
          <span><span class="font-mono text-fg-soft">${day(x.trading_date)}</span> · ${stepName(x.step)}</span>
          <span class="flex items-center gap-2">
            <span class="${`font-mono text-xs uppercase ${x.status === 'failed' ? 'text-bad' : 'text-fg-soft'}`}">${x.status}</span>
            ${x.status === 'failed' || x.status === 'skipped' ? html`<button type="button" class="${secondary}" @click="${() => act('POST', '/api/admin/steps/rerun', { step: x.step, date: x.trading_date }, `${stepName(x.step)} will run again within a minute.`)}">Run again</button>` : ''}
          </span>
          ${x.error ? html`<span class="w-full text-fg-soft">${x.error}</span>` : ''}
        </li>`)}</ul>` : html`<p class="text-fg-soft">Nothing has run yet.</p>`}
      </section>`)}

      ${Loadable(settings, (s) => html`<section class="${panel}" aria-labelledby="rules">
        <h2 id="rules" class="${h2}">Rules and budget</h2>
        <form class="grid gap-4 sm:grid-cols-2" @submit="${/** @param {Event} e */ (e) => {
          e.preventDefault()
          const v = formValues(/** @type {HTMLFormElement} */ (e.target))
          /** @type {Record<string, unknown>} */
          const body = { galleryEnabled: v.galleryEnabled === 'on', budgetCeilingUsd: Number(v.budgetCeilingUsd), positionCapPct: Number(v.positionCapPct), perTradeCostUsd: Number(v.perTradeCostUsd) }
          if (s.state === 'setup') body.startingCashUsd = Number(v.startingCashUsd)
          act('PATCH', '/api/admin/settings', body, 'Settings saved.')
        }}">
          <label class="flex min-h-11 items-center gap-3 sm:col-span-2">
            <input type="checkbox" name="galleryEnabled" class="h-5 w-5 accent-brand" checked="${s.galleryEnabled ? true : false}" />
            <span><span class="font-semibold text-fg">Open the Gallery</span><span class="block text-sm text-fg-soft">Anyone with the address can read every screen except this one, the costs and the briefing pack.</span></span>
          </label>
          <label class="block"><span class="prompt">Monthly budget, dollars</span><input class="${number}" name="budgetCeilingUsd" type="number" min="1" step="1" value="${String(s.budgetCeilingUsd)}" /></label>
          <label class="block"><span class="prompt">Starting cash per Trader, dollars</span><input class="${number}" name="startingCashUsd" type="number" min="1" step="1" value="${String(s.startingCashUsd)}" disabled="${s.state !== 'setup'}" />
            ${s.state !== 'setup' ? html`<span class="mt-1 block text-sm text-fg-soft">Fixed once the experiment starts.</span>` : ''}</label>
          <label class="block"><span class="prompt">Position cap, percent</span><input class="${number}" name="positionCapPct" type="number" min="1" max="100" step="1" value="${String(s.positionCapPct ?? 20)}" /></label>
          <label class="block"><span class="prompt">Cost per trade, dollars</span><input class="${number}" name="perTradeCostUsd" type="number" min="0" step="0.01" value="${String(s.perTradeCostUsd ?? 0)}" /></label>
          <p class="text-sm text-fg-soft sm:col-span-2">New rules apply to every Trader from its next decision. Past days keep the rules they had.</p>
          <div class="sm:col-span-2"><button type="submit" class="${primary}">Save settings</button></div>
        </form>
      </section>`)}

      ${Loadable(traders, (t) => TradersPanel(t.traders, act))}

      ${Loadable(settings, (s) => MenuPanel(s.menu, act))}
    </div>
  `
}

/**
 * @param {any[]} list
 * @param {(method: 'POST' | 'PATCH', path: string, body: object, done: string) => Promise<boolean>} act
 */
function TradersPanel(list, act) {
  const ui = reactive({ estimate: /** @type {any} */ (null), adding: false })
  /** @param {HTMLFormElement} form */
  const traderFrom = (form) => {
    const v = formValues(form)
    return { name: v.name, provider: v.provider, modelVersion: v.modelVersion, effort: v.effort, cadence: v.cadence, inputUsdPerM: Number(v.inputUsdPerM), cachedUsdPerM: Number(v.cachedUsdPerM), outputUsdPerM: Number(v.outputUsdPerM) }
  }
  return html`<section class="${panel}" aria-labelledby="line-up">
    <h2 id="line-up" class="${h2}">The line-up</h2>
    <ul class="flex flex-col">${list.map((t) => html`<li class="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
      <span class="flex flex-col">${TraderName({ name: t.name, kind: t.kind, colourSlot: t.colour_slot })}
        <span class="font-mono text-xs text-fg-soft">${t.kind === 'benchmark' ? 'Holds SPY' : `${t.provider} · ${t.model_version} · ${t.effort}`}${t.status !== 'active' ? ` · ${t.status}` : ''}</span></span>
      ${t.kind === 'ai' && t.status === 'active' ? html`<button type="button" class="${secondary}" @click="${() => { if (confirm(`Retire ${t.name}? Everything it holds sells at the next open, and it stops deciding.`)) act('POST', `/api/admin/traders/${t.id}/retire`, {}, `${t.name} will be retired.`) }}">Retire</button>` : ''}
    </li>`.key(t.id))}</ul>
    ${() => !ui.adding
      ? html`<div><button type="button" class="${secondary}" @click="${() => { ui.adding = true }}">Add a Trader</button></div>`
      : html`<form class="grid gap-4 border-t border-line pt-4 sm:grid-cols-2" @submit="${/** @param {Event} e */ async (e) => {
          e.preventDefault()
          if (await act('POST', '/api/admin/traders', traderFrom(/** @type {HTMLFormElement} */ (e.target)), 'Trader added. It joins at the next evening run.')) ui.adding = false
        }}">
        <p class="text-sm text-fg-soft sm:col-span-2">A new Trader starts with fresh cash and its own colour for life. A model's version and effort never change: a different model is a new Trader.</p>
        <label class="block"><span class="prompt">Name</span><input class="${input}" name="name" required placeholder="Claude Opus daily" /></label>
        <label class="block"><span class="prompt">Provider</span><select class="${input}" name="provider"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="google">Google</option><option value="deepseek">DeepSeek</option></select></label>
        <label class="block"><span class="prompt">Exact model version</span><input class="${input}" name="modelVersion" required /></label>
        <label class="block"><span class="prompt">Effort</span><select class="${input}" name="effort"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option><option value="default">Provider default</option></select></label>
        <label class="block"><span class="prompt">Decides</span><select class="${input}" name="cadence"><option value="daily">Every evening</option><option value="weekly">Once a week</option></select></label>
        <label class="block"><span class="prompt">Input price, $ per million tokens</span><input class="${number}" name="inputUsdPerM" type="number" min="0" step="0.01" required /></label>
        <label class="block"><span class="prompt">Cached input price, $ per million</span><input class="${number}" name="cachedUsdPerM" type="number" min="0" step="0.01" value="0" /></label>
        <label class="block"><span class="prompt">Output price, $ per million tokens</span><input class="${number}" name="outputUsdPerM" type="number" min="0" step="0.01" required /></label>
        ${() => fresh(JSON.stringify(ui.estimate), ui.estimate ? html`<p class="text-sm text-fg sm:col-span-2" role="status">Adds about $${ui.estimate.addedUsd.toFixed(2)} a month, for a projected $${ui.estimate.projectedUsd.toFixed(2)} of the $${ui.estimate.ceilingUsd.toFixed(2)} budget.${ui.estimate.warning ? html` <strong class="text-bad">${ui.estimate.warning}</strong>` : ''}</p>` : '')}
        <div class="flex flex-wrap gap-2 sm:col-span-2">
          <button type="button" class="${secondary}" @click="${async (/** @type {Event} */ e) => {
            const form = /** @type {HTMLFormElement} */ (/** @type {HTMLElement} */ (e.target).closest('form'))
            const r = await send('POST', '/api/admin/traders/estimate', traderFrom(form))
            ui.estimate = r.ok ? r.data : { addedUsd: 0, projectedUsd: 0, ceilingUsd: 0, warning: r.error }
          }}">Estimate the cost</button>
          <button type="submit" class="${primary}">Add the Trader</button>
          <button type="button" class="${secondary}" @click="${() => { ui.adding = false }}">Cancel</button>
        </div>
      </form>`}
  </section>`
}

/**
 * @param {Array<{ ticker: string, name: string, asset_class: string, on_menu: number }>} menu
 * @param {(method: 'POST' | 'PATCH', path: string, body: object, done: string) => Promise<boolean>} act
 */
function MenuPanel(menu, act) {
  const ui = reactive({ query: '' })
  const off = menu.filter((m) => !m.on_menu).length
  return html`<section class="${panel}" aria-labelledby="menu">
    <h2 id="menu" class="${h2}">Stock list</h2>
    <p class="max-w-prose text-[15px] text-fg-soft">${menu.length} stocks and funds, ${off} taken off. A Trader can still sell a stock that was taken off, but nobody can buy it.</p>
    <label class="block sm:max-w-xs"><span class="prompt">Find a ticker or name</span><input class="${input}" type="search" @input="${/** @param {Event} e */ (e) => { ui.query = /** @type {HTMLInputElement} */ (e.target).value.trim().toLowerCase() }}" /></label>
    ${() => {
      const hits = menu.filter((m) => !ui.query || m.ticker.toLowerCase().startsWith(ui.query) || m.name.toLowerCase().includes(ui.query))
      return fresh(ui.query, html`<p class="text-sm text-fg-soft">${ui.query ? `${hits.length} of ${menu.length} match.` : `All ${menu.length}, scroll to see them.`}</p>
      <ul class="flex max-h-[28rem] flex-col overflow-y-auto overscroll-contain rounded-control border border-line px-3" tabindex="0" aria-label="Stocks and funds">${hits.map((m) => html`<li class="flex items-center justify-between gap-2 border-t border-line py-1.5 text-sm first:border-t-0">
        <span><span class="font-mono font-semibold text-fg">${m.ticker}</span> <span class="text-fg-soft">${m.name}</span></span>
        <button type="button" class="${secondary}" @click="${() => act('PATCH', '/api/admin/menu', { ticker: m.ticker, onMenu: !m.on_menu }, m.on_menu ? `${m.ticker} is off the list from now.` : `${m.ticker} is back on the list.`)}">${m.on_menu ? 'Take off' : 'Put back'}</button>
      </li>`.key(m.ticker))}</ul>`)
    }}
  </section>`
}

export default SettingsPage
