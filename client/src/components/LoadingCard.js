import { html } from '@arrow-js/core'

export function LoadingCard() {
  return html`
    <div class="flex min-h-screen items-center justify-center bg-surface p-4">
      <p class="prompt prompt-caret" role="status">Loading</p>
    </div>
  `
}
