import { html } from '@arrow-js/core'
import { go } from '../framework/router.js'
import { sessionState } from '../state/sessionState.js'
import { ThemeToggle } from '../components/ThemeToggle.js'
import { ToastContainer } from '../components/ToastContainer.js'
import { Link } from '../components/Link.js'

const navItem = 'inline-flex min-h-11 items-center rounded-control px-3 font-mono text-sm text-fg-soft hover:bg-surface-inset hover:text-fg [&[aria-current=page]]:bg-brand-tint [&[aria-current=page]]:text-brand'

// The compact top bar every screen shares: logo mark, name, navigation, the
// Trade Master pill when Cas is logged in, and the paper-trading notice.
/** @param {any} content */
export function AppLayout(content) {
  const signOut = async () => {
    await sessionState.logout()
    go('/login')
  }

  return html`
    <div class="flex min-h-screen flex-col bg-surface">
      <header class="border-b border-line bg-surface-raised">
        <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <a href="/" class="flex min-h-11 items-center gap-2" @click="${/** @param {Event} e */ (e) => { e.preventDefault(); go('/') }}">
            <img src="/mark-terminal.svg" alt="" class="hidden h-8 w-8 dark:block" />
            <img src="/mark-daylight.svg" alt="" class="h-8 w-8 dark:hidden" />
            <span class="font-display text-lg font-bold text-fg">Market Jury</span>
          </a>

          <nav class="flex flex-1 items-center gap-1" aria-label="Main">${Link({ to: '/', children: 'Overview', class: navItem })}</nav>

          <div class="flex items-center gap-2">
            ${() => sessionState.tradeMaster
              ? html`<span class="rounded-full border border-brand px-2.5 py-0.5 font-mono text-xs font-semibold tracking-wide text-brand">TRADE MASTER</span>`
              : ''}
            ${ThemeToggle()}
            ${() => sessionState.tradeMaster
              ? html`<button type="button" class="inline-flex min-h-11 items-center rounded-control px-2 font-mono text-sm text-brand underline underline-offset-4" @click="${signOut}">Sign out</button>`
              : ''}
          </div>
        </div>
      </header>

      <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">${content}</main>

      <footer class="border-t border-line">
        <p class="mx-auto max-w-6xl px-4 py-4 font-mono text-xs text-fg-soft">Virtual money only. Not financial advice.</p>
      </footer>
    </div>
    ${ToastContainer()}
  `
}
