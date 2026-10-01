import { html } from '@arrow-js/core'

// arrow-js patches a re-rendered template in place when its markup matches the
// last one, and values nested inside it can stay stale on screen. A keyed list
// of one is replaced outright when its key changes, so each answer gets its own key.
const keys = new WeakMap()
let nextKey = 0
/** @param {object} data */
const keyOf = (data) => {
  if (!keys.has(data)) keys.set(data, `answer-${++nextKey}`)
  return keys.get(data)
}

// Show a useFetch result: a quiet loading line, a plain error, or the view.
/**
 * @template T
 * @param {{ data: () => T | null, loading: () => boolean, error: () => string | null, status: () => number | null }} request
 * @param {(data: T) => any} view
 */
export function Loadable(request, view) {
  return html`${() => {
    const data = request.data()
    if (data) return fresh(keyOf(/** @type {object} */ (data)), view(data))
    if (request.error()) {
      const error = /** @type {string} */ (request.error())
      const message = !error.startsWith('HTTP') ? error
        : request.status() === 401 ? 'This page needs the Gallery open or the Trade Master logged in.'
        : 'The server did not answer. Try again in a moment.'
      return html`<p class="rounded-panel border border-bad bg-surface-raised p-4 text-fg" role="alert">${message}</p>`
    }
    return html`<p class="prompt prompt-caret py-6" role="status">Loading</p>`
  }}`
}

/**
 * For a reactive slot whose markup stays the same while its values change:
 * draw `content` afresh whenever `key` changes, instead of patching the old one.
 * @param {string | number} key
 * @param {any} content
 */
export function fresh(key, content) {
  return [html`${content}`.key(key)]
}
