import { html, reactive } from '@arrow-js/core'
import { fresh } from './Loadable.js'
import { btnPrimary, btnSecondary, DialogHead, openDialog } from './Dialog.js'
import { checkEnd, endHint, firstChoice, quickPicks } from '../utils/endDate.js'
import { day } from '../utils/format.js'

const input = 'mt-1.5 min-h-11 w-full max-w-[16ch] rounded-control border border-line-strong bg-surface-inset px-3 font-mono text-[15px] text-fg outline-none focus:border-brand focus:bg-surface-raised'

/**
 * "Change the last trading day": quick picks, a date field, a live count and
 * what the change does. Resolves to the picked date, or undefined when kept.
 * @param {import('../utils/endDate.js').EndInfo} info
 * @returns {Promise<string | undefined>}
 */
export function endDateDialog(info) {
  const ui = reactive({ value: info.endDate && info.endDate > info.today ? info.endDate : '' })
  const check = () => checkEnd(info, ui.value)
  const keep = info.endDay ? `Keep day ${info.endDay}` : 'Keep it as it is'
  return openDialog((close, ids) => html`
    ${DialogHead(ids.title, 'Change the last trading day', () => close())}
    <form class="contents" novalidate @submit="${/** @param {Event} e */ (e) => {
      e.preventDefault()
      const c = check()
      if (c.ok) close(c.date)
    }}">
      <div class="mj-dialog__body">
        <p id="${ids.desc}" class="text-[15px] leading-[22px] text-fg-soft">The experiment pauses itself after the evening of its last trading day. Pick a trading day after today, so tonight's orders still have an open to fill at.</p>
        ${quickPicks(info).length ? html`<div class="flex flex-wrap gap-2" role="group" aria-label="Quick picks">${quickPicks(info).map((p) => html`<button type="button" class="${btnSecondary}" @click="${/** @param {Event} e */ (e) => {
          ui.value = p.date
          const field = /** @type {HTMLInputElement | null} */ (/** @type {HTMLElement} */ (e.currentTarget).closest('form')?.querySelector('input[name="endDate"]') ?? null)
          if (field) field.value = p.date
        }}">${p.label}</button>`)}</div>` : ''}
        <label class="flex flex-col gap-1.5">
          <span class="prompt">Last trading day</span>
          <input class="${input}" type="date" name="endDate" min="${firstChoice(info) ?? ''}" max="${info.tradingDays.at(-1) ?? ''}" value="${ui.value}" autofocus
            aria-describedby="end-date-check" @input="${/** @param {Event} e */ (e) => { ui.value = /** @type {HTMLInputElement} */ (e.target).value }}" />
        </label>
        ${() => {
          const c = check()
          if (!ui.value) return ''
          if (!c.ok) return fresh(ui.value, html`<p id="end-date-check" class="text-sm text-bad" role="alert">${c.error}</p>`)
          return fresh(ui.value, html`<p id="end-date-check" class="font-mono text-[13px] text-fg-soft" role="status">${endHint(c)}</p>`)
        }}
        ${() => {
          const c = check()
          return !c.ok ? '' : fresh(ui.value, html`<p class="rounded-control border border-line bg-surface-inset px-3 py-2.5 text-[15px] leading-[22px] text-fg">The experiment pauses itself after ${day(c.date)} (day ${c.day}). From the next evening run, the Traders are told they have ${c.fromToday} trading ${c.fromToday === 1 ? 'day' : 'days'} left. The change is listed on the About page.</p>`)
        }}
      </div>
      <div class="mj-dialog__foot">
        <button type="button" class="${btnSecondary}" @click="${() => close()}">${keep}</button>
        <button type="submit" class="${`${btnPrimary} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}" aria-disabled="${() => String(!check().ok)}">${() => {
          const c = check()
          return c.ok ? `Set ${day(c.date)}` : 'Set the day'
        }}</button>
      </div>
    </form>`)
}
