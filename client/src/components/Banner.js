import { html } from '@arrow-js/core'

// An amber notice for something the Trade Master should act on.
/**
 * @param {any} content
 * @param {{ testid?: string }} [options]
 */
export function Banner(content, { testid = 'banner' } = {}) {
  return html`<div class="flex gap-2.5 rounded-panel border border-warn bg-warn-wash px-4 py-3 text-sm leading-6 text-fg" role="status" data-testid="${testid}">
    <span aria-hidden="true" class="font-mono font-bold text-warn">!</span><div>${content}</div>
  </div>`
}
