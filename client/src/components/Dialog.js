import { html } from '@arrow-js/core'

let nextId = 0

// Every confirmation and every short form that interrupts the page, as a native
// <dialog> opened with showModal(): it traps focus, makes the page behind inert
// and closes on Escape. The browser returns focus to the opener on close.
// Never alert(), confirm() or prompt().

/**
 * Open a dialog and wait for it to close. `render` gets a close function and the
 * dialog's title id; whatever close() is given becomes the result (Escape gives
 * undefined).
 * @template T
 * @param {(close: (value?: T) => void, ids: { title: string, desc: string }) => any} render
 * @param {{ wide?: boolean }} [options]
 * @returns {Promise<T | undefined>}
 */
export function openDialog(render, { wide = false } = {}) {
  const id = `dialog-${++nextId}`
  const ids = { title: `${id}-title`, desc: `${id}-desc` }
  const dialog = document.createElement('dialog')
  dialog.className = wide ? 'mj-dialog mj-dialog--wide' : 'mj-dialog'
  dialog.setAttribute('aria-labelledby', ids.title)
  dialog.setAttribute('aria-describedby', ids.desc)
  /** @type {T | undefined} */
  let result
  /** @param {T} [value] */
  const close = (value) => { result = value; dialog.close() }
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result) }, { once: true })
    document.body.append(dialog)
    render(close, ids)(dialog)
    dialog.showModal()
  })
}

/** The dialog's heading row with its close button. @param {string} titleId @param {any} title @param {() => void} onClose */
export const DialogHead = (titleId, title, onClose) => html`<div class="mj-dialog__head">
  <h2 id="${titleId}" class="font-display text-2xl font-semibold leading-[30px] text-fg">${title}</h2>
  <button type="button" class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control font-mono text-fg-soft hover:bg-surface-inset hover:text-fg" aria-label="Close" @click="${onClose}">✕</button>
</div>`

export const btn = 'inline-flex min-h-11 items-center justify-center rounded-control border px-4 font-mono text-sm font-semibold'
export const btnSecondary = `${btn} border-line-strong text-fg hover:bg-surface-inset`
export const btnPrimary = `${btn} border-brand bg-brand text-on-brand hover:bg-brand-hover`
export const btnDanger = `${btn} border-bad text-bad hover:bg-bad-wash`

/**
 * Ask before an action that matters. The safe choice comes first and has focus;
 * the action button names the action ("Retire Claude · Daily"), never "OK".
 * @param {{ title: string, consequence: string, note?: string, keep: string, action: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export async function confirmDialog({ title, consequence, note = '', keep, action, danger = true }) {
  const yes = await openDialog((close, ids) => html`
    ${DialogHead(ids.title, title, () => close(false))}
    <div class="mj-dialog__body">
      <p id="${ids.desc}" class="${danger ? 'mj-consequence' : 'text-[15px] leading-[22px] text-fg'}">${consequence}</p>
      ${note ? html`<p class="text-[15px] leading-[22px] text-fg-soft">${note}</p>` : ''}
    </div>
    <div class="mj-dialog__foot">
      <button type="button" class="${btnSecondary}" autofocus @click="${() => close(false)}">${keep}</button>
      <button type="button" class="${danger ? btnDanger : btnPrimary}" @click="${() => close(true)}">${action}</button>
    </div>`)
  return yes === true
}
