import { html, reactive, onCleanup } from '@arrow-js/core'
import { useMeta } from '../../framework/index.js'
import { useFetch } from '../../composables/useFetch.js'
import { useToast } from '../../composables/useToast.js'
import { Banner } from '../../components/Banner.js'
import { btnDanger, btnPrimary, btnSecondary, confirmDialog, DialogHead, openDialog } from '../../components/Dialog.js'
import { Disclosure, disclosures } from '../../components/Disclosure.js'
import { fresh, Loadable } from '../../components/Loadable.js'
import { PageHeader } from '../../components/PageHeader.js'
import { stepName } from '../../components/TradeMasterNotice.js'
import { Term } from '../../components/Term.js'
import { TraderName } from '../../components/TraderMark.js'
import { send } from '../../utils/api.js'
import { day, usd } from '../../utils/format.js'
import { displayName } from '../../utils/traders.js'
import { formatClock, NY_TIME_ZONE, viewerTimeZone, zoneLabel } from '../../utils/time.js'

export const meta = { layout: 'app', title: 'Settings · Market Jury' }

const input = 'mt-1.5 min-h-11 w-full rounded-control border border-line-strong bg-surface-inset px-3 font-mono text-[15px] text-fg outline-none focus:border-brand focus:bg-surface-raised'
// Amounts and percentages are short: a 14ch box, right-aligned, its unit outside.
const number = 'mj-input--num min-h-11 rounded-control border border-line-strong bg-surface-inset px-3 font-mono text-[15px] text-fg outline-none focus:border-brand focus:bg-surface-raised'
/** The control bar's buttons: 52px tall, wider padding. @param {string} c */
const big = (c) => c.replace('min-h-11', 'min-h-[52px]').replace('px-4', 'px-6')
const field = 'flex flex-col gap-1.5'

const LABELS = /** @type {Record<string, string>} */ ({ setup: 'Setting up', running: 'Running', paused: 'Paused', ended: 'Ended' })

const VERDICTS = /** @type {Record<string, string>} */ ({ accepted: 'accepted', trimmed: 'trimmed to fit the rules', rejected: 'turned down' })

/**
 * One Trader's dry-run answer, folded away until the Trade Master opens it:
 * its view of the market, then each order with its reason and the Compliance Desk's verdict.
 * @param {any} x a dry-run result
 */
const DryRunAnswer = (x) => html`<details>
  <summary class="min-h-11 cursor-pointer py-2"><span class="font-semibold">${x.trader}</span>: answered with ${x.orders.length} ${x.orders.length === 1 ? 'order' : 'orders'}</summary>
  <div class="mb-2 flex flex-col gap-2 border-l border-line pl-3">
    ${x.marketView ? html`<p class="max-w-prose text-fg-soft">${x.marketView}</p>` : ''}
    ${x.orders.length ? html`<ul class="flex flex-col gap-2">${x.orders.map((/** @type {any} */ o) => html`<li>
      <span class="font-mono">${String(o.side).toUpperCase()} ${o.ticker} ${o.sellAll ? 'all' : usd(o.amountMicro)}</span>
      <span class="text-fg-soft"> · ${VERDICTS[o.verdict] ?? o.verdict}${o.verdict === 'trimmed' && o.approvedAmountMicro !== null ? ` to ${usd(o.approvedAmountMicro)}` : ''}</span>
      <span class="block max-w-prose text-fg-soft">"${o.reason}"</span>
      ${o.note ? html`<span class="block max-w-prose text-fg-faint">${o.note}</span>` : ''}
    </li>`)}</ul>` : html`<p class="max-w-prose text-fg-soft">No trades: "${x.noTradesReason ?? ''}"</p>`}
  </div>
</details>`

/** @param {HTMLFormElement} form */
const formValues = (form) => Object.fromEntries(new FormData(form).entries())

/** "Mon 09:30 NY". @param {string | null} iso */
const nyOpen = (iso) => (iso ? `${new Intl.DateTimeFormat('en-GB', { timeZone: NY_TIME_ZONE, weekday: 'short' }).format(new Date(iso))} ${formatClock(new Date(iso), NY_TIME_ZONE)} NY` : 'the next open')

/** "Thu 21:40 SAST" in the reader's own time. @param {string} iso */
const when = (iso) => {
  const at = new Date(iso)
  const here = viewerTimeZone()
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: here, weekday: 'short' }).format(at)} ${formatClock(at, here)} ${zoneLabel(at, here)}`
}

/**
 * A number field with its unit outside the box ("$ [ 25 ]", "[ 20 ] %").
 * @param {{ label: string, name: string, value?: string, unit: '$' | '%', min?: string, max?: string, step?: string, required?: boolean, disabled?: boolean, help?: any }} f
 */
const NumberField = (f) => html`<label class="${field}">
  <span class="prompt">${f.label}</span>
  <span class="mj-affix">${f.unit === '$' ? '$' : ''}<input class="${number}" name="${f.name}" type="number" inputmode="decimal" min="${f.min ?? '0'}" max="${f.max ?? ''}" step="${f.step ?? '1'}" value="${f.value ?? ''}" required="${f.required ? true : false}" disabled="${f.disabled ? true : false}" />${f.unit === '%' ? '%' : ''}</span>
  ${f.help ? html`<span class="text-[13px] leading-[18px] text-fg-soft">${f.help}</span>` : ''}
</label>`

// Settings: the Trade Master's controls. The experiment's state and its big
// actions sit in a bar at the top; everything else folds away in sections.
function SettingsPage() {
  useMeta({ title: 'Settings · Market Jury' })
  const toast = useToast()
  const status = useFetch('/api/admin/status')
  const settings = useFetch('/api/admin/settings')
  const traders = useFetch('/api/admin/traders')
  const steps = useFetch('/api/admin/steps')
  const rehearsal = useFetch('/api/admin/dry-run')
  const refresh = () => { status.refetch(); settings.refetch(); traders.refetch(); steps.refetch() }
  const added = () => { toast.success('Trader added. It joins at the next evening run.'); refresh() }
  const sections = disclosures({ 'line-up': true, rules: false, menu: false, scheduler: false, 'dry-run': false })
  const ui = reactive({ unsaved: false })

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

  const dryRun = async () => {
    if (rehearsal.data()?.running) return
    const out = await send('POST', '/api/admin/dry-run')
    if (!out.ok) toast.error(out.error)
    rehearsal.refetch()
  }
  const seeResult = () => {
    sections.show('dry-run')
    requestAnimationFrame(() => document.getElementById('dry-run')?.scrollIntoView({ block: 'start' }))
  }

  const allOpen = () => Object.values(sections.open).every(Boolean)

  return html`
    <div class="flex flex-col gap-6">
      ${PageHeader({ eyebrow: 'Trade Master only', title: 'Settings', intro: 'Start or pause the experiment, rehearse it with a dry run, and change the line-up, rules and budget. Nobody else can see this page.' })}

      ${Loadable(status, (s) => html`<div class="flex flex-col gap-2">
        ${ExperimentControl(s, { act, dryRun, running: () => Boolean(rehearsal.data()?.running), lineUp: () => traders.data()?.traders ?? [] })}
        ${() => LastDryRun(rehearsal.data(), seeResult)}
        ${s.missingKeys.length ? Banner(html`These model keys are missing from the server's environment file: <span class="font-mono">${s.missingKeys.join(', ')}</span>. The Traders that need them can't decide until they are added.`) : ''}
      </div>`)}

      <div class="flex flex-col gap-2">
        <div class="flex justify-end">
          <button type="button" class="inline-flex min-h-11 items-center px-2 font-mono text-sm font-semibold text-brand" @click="${() => sections.all(!allOpen())}">${() => (allOpen() ? 'Collapse all' : 'Expand all')}</button>
        </div>

        ${Loadable(traders, (t) => Disclosure({
          id: 'line-up',
          title: 'The line-up',
          summary: () => `${t.traders.filter((/** @type {any} */ x) => x.kind === 'ai').length} Traders · ${t.traders.filter((/** @type {any} */ x) => x.kind === 'ai' && x.status === 'active').length} active`,
          state: sections,
          content: LineUp(t.traders, act, () => status.data()?.nextOpen ?? null, added),
        }))}

        ${Loadable(settings, (s) => Disclosure({
          id: 'rules',
          title: 'Rules and budget',
          summary: () => html`${ui.unsaved ? html`<span class="text-warn">Unsaved · </span>` : ''}Budget $${s.budgetCeilingUsd} · cap ${s.positionCapPct ?? 20}% · $${s.perTradeCostUsd ?? 0} per trade · Gallery ${s.galleryEnabled ? 'open' : 'closed'}`,
          state: sections,
          content: Rules(s, act, ui),
        }))}

        ${Loadable(settings, (s) => Disclosure({
          id: 'menu',
          title: 'Stock list',
          summary: () => `${s.menu.length} tickers${s.menu.some((/** @type {any} */ m) => !m.on_menu) ? ` · ${s.menu.filter((/** @type {any} */ m) => !m.on_menu).length} taken off` : ''}`,
          state: sections,
          content: MenuPanel(s.menu, act),
        }))}

        ${Loadable(steps, (st) => Disclosure({
          id: 'scheduler',
          title: 'Scheduler',
          summary: () => {
            const failed = st.steps.filter((/** @type {any} */ x) => x.status === 'failed').length
            const last = st.steps[0]
            return last ? `${failed ? `${failed} failed · ` : ''}Last: ${day(last.trading_date)} · ${stepName(last.step)} · ${last.status}` : 'Nothing has run yet'
          },
          state: sections,
          content: Scheduler(st.steps, act),
        }))}

        ${Disclosure({
          id: 'dry-run',
          title: 'Last dry run',
          summary: () => {
            const r = rehearsal.data()
            return r?.running ? 'Going now' : r?.result ? `Briefing pack of ${day(r.result.packDate)} · ${r.result.results.length} Traders` : r?.error ? 'It failed' : 'None since the server last started'
          },
          state: sections,
          content: html`<p class="max-w-prose text-[15px] text-fg-soft">Every Trader decides on the latest ${Term('briefing pack')} as if for real, but nothing is queued or filled. It costs the same as one evening's run and takes a few minutes.</p>
            ${() => {
              const r = rehearsal.data()
              return fresh(`${r?.running}-${r?.finishedAt}`, html`
                ${r?.running ? html`<p class="font-mono text-sm text-fg" role="status">Dry run going. Every Trader is deciding…</p>` : ''}
                ${r?.error ? Banner(r.error) : ''}
                ${r?.result ? html`<ul class="flex flex-col gap-1.5">${r.result.results.map((/** @type {any} */ x) => html`<li class="text-sm text-fg">${x.ok ? DryRunAnswer(x) : html`<span class="font-semibold">${x.trader}</span>: <span class="text-bad">${x.error}</span>`}</li>`)}</ul>` : ''}
                ${!r?.running && !r?.result && !r?.error ? html`<p class="text-fg-soft">No dry run since the server last started.</p>` : ''}
              `)
            }}`,
        })}
      </div>
    </div>
  `
}

/**
 * The top of Settings: the experiment's state and its big actions, set apart
 * from the settings below so they read as actions, not fields.
 * @param {any} s admin status
 * @param {{ act: Function, dryRun: () => void, running: () => boolean, lineUp: () => any[] }} handlers
 */
function ExperimentControl(s, { act, dryRun, running, lineUp }) {
  const active = () => lineUp().filter((t) => t.kind === 'ai' && t.status === 'active').length
  const start = async () => {
    const ok = await confirmDialog({
      title: 'Start the experiment?',
      consequence: `Every Trader gets its starting cash and makes its first decisions on the evening of ${day(s.firstDecisionDate)}. It can be paused, but not undone.`,
      note: 'Run a dry run first if you have not checked that every model answers.',
      keep: 'Not yet',
      action: 'Start the experiment',
    })
    if (ok) act('POST', '/api/admin/experiment/start', {}, 'The experiment has started.')
  }
  const pause = async () => {
    const ok = await confirmDialog({
      title: 'Pause the experiment?',
      consequence: 'Nothing runs until you resume: no briefing packs, no decisions, no fills. Orders already queued wait.',
      keep: 'Keep running',
      action: 'Pause',
      danger: false,
    })
    if (ok) act('POST', '/api/admin/experiment/pause', {}, 'Paused. Nothing runs until you resume.')
  }
  const resume = async () => {
    const ok = await confirmDialog({
      title: 'Resume the experiment?',
      consequence: `The scheduler picks up from the next due step. Waiting orders fill at the next open (${nyOpen(s.nextOpen)}).`,
      keep: 'Stay paused',
      action: 'Resume',
      danger: false,
    })
    if (ok) act('POST', '/api/admin/experiment/resume', {}, 'Resumed. Waiting orders fill at the next open.')
  }
  const dryButton = () => html`<button type="button" class="${big(btnSecondary)}" aria-disabled="${() => String(running())}" @click="${dryRun}">${() => (running() ? 'Dry run going…' : 'Run a dry run')}</button>`

  const copy = /** @type {Record<string, [string, any]>} */ ({
    setup: ['Ready to start?', html`Starting gives every Trader its starting cash and runs the first decisions on the evening of ${day(s.firstDecisionDate)}. It can be paused, not undone.`],
    running: [`Running · Day ${s.day} of 63`, html`Every step runs on its own on the New York calendar. Pausing stops them until you resume.`],
    paused: ['Paused', html`Nothing runs until you resume. Queued orders are kept and fill at the next open after that.`],
    ended: ['The experiment has ended', html`Everything stays on the site to read.`],
  })
  const [title, line] = copy[s.state] ?? copy.setup

  return html`<section class="mj-control" aria-labelledby="experiment">
    <div class="flex max-w-[36em] flex-col gap-1">
      <p class="prompt prompt-caret" data-testid="experiment-state">${LABELS[s.state] ?? s.state}</p>
      <h2 id="experiment" class="font-display text-2xl font-semibold leading-[30px] text-fg">${title}</h2>
      <p class="text-[15px] leading-[22px] text-fg-soft">${line}${s.state === 'setup' ? html` ${() => `${active()} Traders are ready.`}` : ''}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      ${s.state === 'setup' ? html`${dryButton()}<button type="button" class="${big(btnPrimary)}" @click="${start}">Start the experiment</button>` : ''}
      ${s.state === 'running' ? html`${dryButton()}<button type="button" class="${big(btnSecondary)}" @click="${pause}">Pause</button>` : ''}
      ${s.state === 'paused' ? html`<button type="button" class="${big(btnPrimary)}" @click="${resume}">Resume</button>` : ''}
    </div>
  </section>`
}

/**
 * "Last dry run Thu 21:40 SAST · 8 Traders · $0.31 · See result".
 * @param {any} r the dry run's state
 * @param {() => void} seeResult
 */
function LastDryRun(r, seeResult) {
  if (!r || (!r.result && !r.error && !r.running)) return ''
  const link = html`<button type="button" class="font-mono text-brand underline underline-offset-4" @click="${seeResult}">See result</button>`
  if (r.running) return html`<p class="font-mono text-[13px] text-fg-soft" role="status">Dry run going since ${when(r.startedAt)}. Every Trader is deciding.</p>`
  if (r.error) return html`<p class="font-mono text-[13px] text-fg-soft">Last dry run ${when(r.finishedAt)} failed · ${link}</p>`
  const cost = r.result.results.reduce((/** @type {number} */ sum, /** @type {any} */ x) => sum + (x.costMicro ?? 0), 0)
  return html`<p class="font-mono text-[13px] text-fg-soft">Last dry run ${when(r.finishedAt)} · ${r.result.results.length} Traders · ${usd(cost)} · ${link}</p>`
}

/**
 * @param {any} s settings
 * @param {Function} act
 * @param {{ unsaved: boolean }} ui
 */
function Rules(s, act, ui) {
  return html`<form class="grid gap-4 sm:grid-cols-2" @input="${() => { ui.unsaved = true }}" @submit="${/** @param {Event} e */ async (e) => {
    e.preventDefault()
    const v = formValues(/** @type {HTMLFormElement} */ (e.target))
    /** @type {Record<string, unknown>} */
    const body = { galleryEnabled: v.galleryEnabled === 'on', budgetCeilingUsd: Number(v.budgetCeilingUsd), positionCapPct: Number(v.positionCapPct), perTradeCostUsd: Number(v.perTradeCostUsd) }
    if (s.state === 'setup') body.startingCashUsd = Number(v.startingCashUsd)
    if (await act('PATCH', '/api/admin/settings', body, 'Settings saved.')) ui.unsaved = false
  }}">
    <label class="flex min-h-11 items-center gap-3 sm:col-span-2">
      <input type="checkbox" name="galleryEnabled" class="h-5 w-5 accent-brand" checked="${s.galleryEnabled ? true : false}" />
      <span><span class="font-semibold text-fg">Open the Gallery</span><span class="block text-sm text-fg-soft">Anyone with the address can read every screen except this one, the costs and the briefing pack. They can't change anything.</span></span>
    </label>
    ${NumberField({ label: 'Monthly budget', name: 'budgetCeilingUsd', unit: '$', min: '1', value: String(s.budgetCeilingUsd) })}
    ${NumberField({ label: 'Starting cash per Trader', name: 'startingCashUsd', unit: '$', min: '1', value: String(s.startingCashUsd), disabled: s.state !== 'setup', help: s.state !== 'setup' ? 'Fixed once the experiment starts.' : '' })}
    ${NumberField({ label: 'Position cap', name: 'positionCapPct', unit: '%', min: '1', max: '100', value: String(s.positionCapPct ?? 20) })}
    ${NumberField({ label: 'Cost per trade', name: 'perTradeCostUsd', unit: '$', step: '0.01', value: String(s.perTradeCostUsd ?? 0) })}
    <p class="text-sm text-fg-soft sm:col-span-2">New rules apply to every Trader from its next decision. Past days keep the rules they had.</p>
    <div class="flex justify-end sm:col-span-2"><button type="submit" class="${btnPrimary}">Save settings</button></div>
  </form>`
}

/**
 * @param {any[]} steps
 * @param {Function} act
 */
function Scheduler(steps, act) {
  return html`<p class="max-w-prose text-[15px] text-fg-soft">Each trading day the Opening Bell fills orders half an hour after the open; after the close the Floor Runner builds the pack, the Traders decide and the Columnist writes. A failed step tries again on its own three times.</p>
    ${steps.length ? html`<ul class="flex flex-col">${steps.slice(0, 24).map((/** @type {any} */ x) => html`<li class="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm">
      <span><span class="font-mono text-fg-soft">${day(x.trading_date)}</span> · ${stepName(x.step)}</span>
      <span class="flex items-center gap-2">
        <span class="${`font-mono text-xs uppercase ${x.status === 'failed' ? 'text-bad' : 'text-fg-soft'}`}">${x.status}</span>
        ${x.status === 'failed' || x.status === 'skipped' ? html`<button type="button" class="${btnSecondary}" @click="${() => act('POST', '/api/admin/steps/rerun', { step: x.step, date: x.trading_date }, `${stepName(x.step)} will run again within a minute.`)}">Run again</button>` : ''}
      </span>
      ${x.error ? html`<span class="w-full text-fg-soft">${x.error}</span>` : ''}
    </li>`)}</ul>` : html`<p class="text-fg-soft">Nothing has run yet.</p>`}`
}

/**
 * @param {any[]} list
 * @param {Function} act
 * @param {() => string | null} nextOpen
 * @param {() => void} added
 */
function LineUp(list, act, nextOpen, added) {
  /** @param {any} t */
  const retire = async (t) => {
    const name = displayName(t.name)
    const holds = t.positions ? `All ${t.positions} ${t.positions === 1 ? 'position sells' : 'positions sell'}` : 'Anything it holds sells'
    const ok = await confirmDialog({
      title: `Retire ${name}?`,
      consequence: `${holds} at the next open (${nyOpen(nextOpen())}) and it stops deciding. This can't be undone.`,
      note: 'Its history and charts stay on the site, greyed out as Retired.',
      keep: `Keep ${name}`,
      action: `Retire ${name}`,
    })
    if (ok) act('POST', `/api/admin/traders/${t.id}/retire`, {}, `${name} will be retired.`)
  }
  return html`<ul class="flex flex-col">${list.map((t) => html`<li class="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 first:border-t-0">
      <span class="flex flex-col">${TraderName({ name: t.name, kind: t.kind, colourSlot: t.colour_slot })}
        <span class="font-mono text-xs text-fg-soft">${t.kind === 'benchmark' ? 'Holds SPY' : `${t.provider} · ${t.model_version} · ${t.effort}`}${t.status !== 'active' ? ` · ${t.status}` : ''}</span></span>
      ${t.kind === 'ai' && t.status === 'active' ? html`<button type="button" class="${btnSecondary}" @click="${() => retire(t)}">Retire</button>` : ''}
    </li>`.key(t.id))}</ul>
    <div><button type="button" class="${btnSecondary}" @click="${() => addTrader(added)}">Add a Trader</button></div>`
}

const PROVIDERS = [['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['google', 'Google'], ['deepseek', 'DeepSeek']]
const EFFORTS = [['medium', 'Medium'], ['low', 'Low'], ['high', 'High'], ['default', 'Provider default']]

/**
 * The Add a Trader form, in a wide dialog. The cost preview updates as the
 * fields fill in; Add stays unavailable until the form is complete.
 * @param {() => void} added called once the Trader is in
 */
function addTrader(added) {
  const ui = reactive({ estimate: /** @type {any} */ (null), valid: false, error: '', errors: /** @type {Record<string, string>} */ ({}) })
  /** @param {HTMLFormElement} form */
  const traderFrom = (form) => {
    const v = formValues(form)
    return { name: v.name, provider: v.provider, modelVersion: v.modelVersion, effort: v.effort, cadence: v.cadence, inputUsdPerM: Number(v.inputUsdPerM), cachedUsdPerM: Number(v.cachedUsdPerM), outputUsdPerM: Number(v.outputUsdPerM) }
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let wait
  /** @param {HTMLFormElement} form */
  const changed = (form) => {
    ui.valid = form.checkValidity()
    clearTimeout(wait)
    if (!ui.valid) { ui.estimate = null; return }
    wait = setTimeout(async () => {
      const r = await send('POST', '/api/admin/traders/estimate', traderFrom(form))
      ui.estimate = r.ok ? r.data : null
    }, 300)
  }
  /** @param {string} name */
  const errorFor = (name) => html`<span class="text-[13px] leading-[18px] text-bad">${() => ui.errors[name] ?? ''}</span>`
  /** @param {string} label @param {string} name @param {string[][]} options */
  const select = (label, name, options) => html`<label class="${field}"><span class="prompt">${label}</span><select class="mj-select" name="${name}">${options.map(([value, text]) => html`<option value="${value}">${text}</option>`)}</select></label>`

  openDialog((close, ids) => html`
    ${DialogHead(ids.title, 'Add a Trader', () => close())}
    <form class="contents" novalidate
      @input="${/** @param {Event} e */ (e) => { const el = /** @type {HTMLInputElement} */ (e.target); if (el.name && ui.errors[el.name]) ui.errors[el.name] = ''; changed(/** @type {HTMLFormElement} */ (el.form)) }}"
      @submit="${/** @param {Event} e */ async (e) => {
        e.preventDefault()
        const form = /** @type {HTMLFormElement} */ (e.target)
        ui.errors = Object.fromEntries(Array.from(form.elements).filter((el) => el instanceof HTMLInputElement && !el.validity.valid).map((el) => [/** @type {HTMLInputElement} */ (el).name, /** @type {HTMLInputElement} */ (el).validationMessage]))
        if (!form.checkValidity()) return
        const r = await send('POST', '/api/admin/traders', traderFrom(form))
        if (!r.ok) { ui.error = r.error; return }
        close()
        added()
      }}">
      <div class="mj-dialog__body">
        <p id="${ids.desc}" class="text-[15px] leading-[22px] text-fg-soft">A new Trader starts with fresh cash and its own colour for life. A model's version and effort never change: a different model is a new Trader.</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="${`${field} sm:col-span-2`}"><span class="prompt">Name</span><input class="${input}" name="name" required placeholder="Claude Opus daily" autofocus />${errorFor('name')}</label>
          ${select('Provider', 'provider', PROVIDERS)}
          <label class="${field}"><span class="prompt">Exact model version</span><input class="${input}" name="modelVersion" required />${errorFor('modelVersion')}</label>
          ${select('Effort', 'effort', EFFORTS)}
          ${select('Decides', 'cadence', [['daily', 'Every evening'], ['weekly', 'Once a week']])}
          ${NumberField({ label: 'Input, $ per million tokens', name: 'inputUsdPerM', unit: '$', step: '0.01', required: true })}
          ${NumberField({ label: 'Cached input, $ per million', name: 'cachedUsdPerM', unit: '$', step: '0.01', value: '0' })}
          ${NumberField({ label: 'Output, $ per million tokens', name: 'outputUsdPerM', unit: '$', step: '0.01', required: true })}
        </div>
        ${() => fresh(JSON.stringify(ui.estimate), ui.estimate ? html`<p class="text-sm text-fg" role="status">Adds about $${ui.estimate.addedUsd.toFixed(2)} a month, for a projected $${ui.estimate.projectedUsd.toFixed(2)} of the $${ui.estimate.ceilingUsd.toFixed(2)} budget.${ui.estimate.warning ? html` <strong class="text-bad">${ui.estimate.warning}</strong>` : ''}</p>` : html`<p class="text-sm text-fg-soft">The monthly cost shows here once the prices are in.</p>`)}
        ${() => (ui.error ? html`<p class="text-sm text-bad" role="alert">${ui.error}</p>` : '')}
      </div>
      <div class="mj-dialog__foot">
        <button type="button" class="${btnSecondary}" @click="${() => close()}">Cancel</button>
        <button type="submit" class="${btnPrimary}" aria-disabled="${() => String(!ui.valid)}">Add the Trader</button>
      </div>
    </form>`, { wide: true })
}

/**
 * @param {Array<{ ticker: string, name: string, asset_class: string, on_menu: number }>} menu
 * @param {Function} act
 */
function MenuPanel(menu, act) {
  const ui = reactive({ query: '' })
  const off = menu.filter((m) => !m.on_menu).length
  return html`<p class="max-w-prose text-[15px] text-fg-soft">${menu.length} stocks and funds, ${off} taken off. A Trader can still sell a stock that was taken off, but nobody can buy it.</p>
    <label class="${`${field} sm:max-w-xs`}"><span class="prompt">Find a ticker or name</span><input class="${input}" type="search" @input="${/** @param {Event} e */ (e) => { ui.query = /** @type {HTMLInputElement} */ (e.target).value.trim().toLowerCase() }}" /></label>
    ${() => {
      const hits = menu.filter((m) => !ui.query || m.ticker.toLowerCase().startsWith(ui.query) || m.name.toLowerCase().includes(ui.query))
      return fresh(ui.query, html`<p class="text-sm text-fg-soft">${ui.query ? `${hits.length} of ${menu.length} match.` : `All ${menu.length}, scroll to see them.`}</p>
      <ul class="flex max-h-[28rem] flex-col overflow-y-auto overscroll-contain rounded-control border border-line px-3" tabindex="0" aria-label="Stocks and funds">${hits.map((m) => html`<li class="flex items-center justify-between gap-2 border-t border-line py-1.5 text-sm first:border-t-0">
        <span><span class="font-mono font-semibold text-fg">${m.ticker}</span> <span class="text-fg-soft">${m.name}</span></span>
        <button type="button" class="${btnSecondary}" @click="${() => act('PATCH', '/api/admin/menu', { ticker: m.ticker, onMenu: !m.on_menu }, m.on_menu ? `${m.ticker} is off the list from now.` : `${m.ticker} is back on the list.`)}">${m.on_menu ? 'Take off' : 'Put back'}</button>
      </li>`.key(m.ticker))}</ul>`)
    }}`
}

export default SettingsPage
