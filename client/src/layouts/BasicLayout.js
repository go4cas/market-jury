import { html } from '@arrow-js/core'
import { ToastContainer } from '../components/ToastContainer.js'
import { Link } from '../components/Link.js'

// A centred panel for screens outside the app shell (login, not found), with
// the "About this site" link under it so the data note is reachable signed out.
/** @param {any} content */
export function BasicLayout(content) {
  return html`
    <div class="flex min-h-screen flex-col items-center justify-center gap-2 bg-surface p-4">
      <main class="w-full max-w-sm rounded-panel border border-line bg-surface-raised p-6 shadow-panel sm:p-8">
        ${content}
      </main>
      ${Link({ to: '/about', class: 'inline-flex min-h-11 items-center font-mono text-xs text-fg-soft underline underline-offset-4 hover:text-fg', children: 'About this site' })}
    </div>
    ${ToastContainer()}
  `
}
