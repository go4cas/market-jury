import { html, reactive } from '@arrow-js/core'
import { GLOSSARY } from '../utils/glossary.js'

let nextId = 0

// A trading word with a dotted steel-blue underline. Tapping it shows its
// plain-language definition right under the sentence.
/**
 * @param {string} word the text shown
 * @param {import('../utils/glossary.js').GlossaryKey} [key] the glossary entry (default: the word, lower-cased)
 */
export function Term(word, key) {
  const entry = key ?? /** @type {import('../utils/glossary.js').GlossaryKey} */ (word.toLowerCase())
  const id = `term-${++nextId}`
  const state = reactive({ open: false })
  return html`<span class="relative inline"><button
      type="button"
      class="cursor-help bg-highlighter px-0.5 text-inherit underline decoration-brand decoration-dotted decoration-2 underline-offset-4"
      aria-expanded="${() => (state.open ? 'true' : 'false')}"
      aria-controls="${id}"
      @click="${() => { state.open = !state.open }}"
    >${word}</button><span
      id="${id}"
      role="note"
      class="${() => (state.open ? 'mt-1 block rounded-control border border-line-strong bg-surface-raised p-3 text-sm font-normal normal-case tracking-normal text-fg shadow-panel' : 'hidden')}"
    >${GLOSSARY[entry] ?? ''}</span></span>`
}
