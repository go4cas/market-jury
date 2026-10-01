import { html } from '@arrow-js/core'
import { ToastContainer } from '../components/ToastContainer.js'

// A centred panel for screens outside the app shell (login, not found).
/** @param {any} content */
export function BasicLayout(content) {
  return html`
    <div class="flex min-h-screen items-center justify-center bg-surface p-4">
      <main class="w-full max-w-sm rounded-panel border border-line bg-surface-raised p-6 shadow-panel sm:p-8">
        ${content}
      </main>
    </div>
    ${ToastContainer()}
  `
}
