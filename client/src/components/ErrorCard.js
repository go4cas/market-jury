import { html } from '@arrow-js/core'
import { go } from '../framework/router.js'

export function ErrorCard(message = 'Something went wrong.') {
  return html`
    <div class="flex min-h-screen items-center justify-center bg-surface p-4">
      <div class="max-w-md rounded-panel border border-bad bg-surface-raised p-8 text-center">
        <p class="prompt">Error</p>
        <h1 class="mt-2 text-lg font-semibold text-fg">This screen could not load</h1>
        <p class="mt-2 text-sm text-fg-soft">${message}</p>
        <button
          type="button"
          class="mt-5 inline-flex min-h-11 items-center rounded-control border border-line-strong px-4 font-mono text-sm font-semibold text-fg hover:bg-surface-inset"
          @click="${() => go('/')}"
        >Back to the Overview</button>
      </div>
    </div>
  `
}
