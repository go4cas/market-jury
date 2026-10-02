import { html } from '@arrow-js/core'
import { GLOSSARY } from '../utils/glossary.js'

let nextId = 0

/** @param {string} key */
const define = (key) => GLOSSARY[/** @type {import('../utils/glossary.js').GlossaryKey} */ (key)] ?? ''

// Explanations open in a native popover (`popover="auto"`): it sits in the top
// layer, closes on Escape or a click outside, only one is open at a time, and it
// never pushes the text around it. Opening places it under its trigger.
/**
 * @param {string} id
 * @param {string} title shown as the popover's heading
 * @param {string} key glossary entry
 */
function Pop(id, title, key) {
  /** @param {Event} e */
  const placed = (e) => {
    const pop = /** @type {HTMLElement} */ (e.target)
    const trigger = /** @type {HTMLElement | null} */ (document.querySelector(`[aria-controls="${id}"]`))
    const open = /** @type {ToggleEvent} */ (e).newState === 'open'
    trigger?.setAttribute('aria-expanded', String(open))
    if (open && trigger) place(pop, trigger)
  }
  return html`<span id="${id}" popover="auto" role="dialog" aria-labelledby="${`${id}-title`}" class="mj-pop" @toggle="${placed}">
    <span class="block font-mono text-xs font-medium uppercase tracking-wide text-brand">Plain meaning</span>
    <span id="${`${id}-title`}" class="block font-display text-xl font-bold leading-[26px] text-fg">${title}</span>
    <span class="mt-1 block text-[15px] font-normal normal-case leading-[22px] tracking-normal text-fg">${define(key)}</span>
  </span>`
}

const GUTTER = 16

/**
 * Under the trigger and left-aligned with it; above it when there is no room
 * below; always 16px inside the viewport. Phones get the full width less gutters.
 * @param {HTMLElement} pop
 * @param {HTMLElement} trigger
 */
export function place(pop, trigger) {
  const r = trigger.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  pop.style.width = vw < 480 ? `${vw - 2 * GUTTER}px` : ''
  const { width, height } = pop.getBoundingClientRect()
  const left = Math.min(Math.max(GUTTER, r.left), vw - GUTTER - width)
  const below = r.bottom + 6
  const top = below + height > vh - GUTTER && r.top - 6 - height >= GUTTER ? r.top - 6 - height : below
  pop.style.left = `${Math.max(GUTTER, left)}px`
  pop.style.top = `${top}px`
}

// A trading word in a sentence: highlighter wash and a dotted steel-blue
// underline. Tapping it (or Enter/Space) opens its plain meaning.
/**
 * @param {string} word the text shown
 * @param {import('../utils/glossary.js').GlossaryKey} [key] the glossary entry (default: the word, lower-cased)
 */
export function Term(word, key) {
  const entry = key ?? word.toLowerCase()
  const id = `term-${++nextId}`
  return html`<span class="inline"><button
      type="button"
      class="cursor-help rounded-[2px] bg-highlighter px-0.5 text-inherit underline decoration-brand decoration-dotted decoration-2 underline-offset-4"
      popovertarget="${id}"
      aria-expanded="false"
      aria-controls="${id}"
      aria-describedby="${id}"
    >${word}</button>${Pop(id, word, entry)}</span>`
}

// The small round "?" after a column head or label (Worst drop, Cash, Rule
// breaks): the same popover, with a 44px hit area around an 18px circle.
/**
 * @param {string} label the column's name, as shown ("Worst drop")
 * @param {import('../utils/glossary.js').GlossaryKey} [key] default: the label, lower-cased
 */
export function Hint(label, key) {
  const entry = key ?? label.toLowerCase()
  const id = `hint-${++nextId}`
  return html`<button
      type="button"
      class="mj-hint"
      popovertarget="${id}"
      aria-expanded="false"
      aria-controls="${id}"
      aria-label="${`What is ${label.toLowerCase()}?`}"
    >?</button>${Pop(id, label, entry)}`
}
