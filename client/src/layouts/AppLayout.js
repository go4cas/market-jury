import { html } from '@arrow-js/core'
import { go } from '../framework/router.js'
import { sessionState } from '../state/sessionState.js'
import { ThemeToggle } from '../components/ThemeToggle.js'
import { GitHubLink } from '../components/GitHubLink.js'
import { MenuButton, MenuPanel } from '../components/MainMenu.js'
import { ToastContainer } from '../components/ToastContainer.js'
import { Link } from '../components/Link.js'
import { TradeMasterNotice } from '../components/TradeMasterNotice.js'

const navItem = 'inline-flex min-h-11 shrink-0 items-center rounded-control px-3 font-mono text-sm text-fg-soft hover:bg-surface-inset hover:text-fg [&[aria-current=page]]:bg-brand-tint [&[aria-current=page]]:text-brand'

const PUBLIC = [['/', 'Overview'], ['/standings', 'Standings'], ['/yesterday', 'Yesterday'], ['/history', 'History'], ['/columnist', 'Columnist'], ['/cast', 'Cast'], ['/compare', 'Compare']]
const TRADE_MASTER = [['/admin/settings', 'Settings'], ['/admin/costs', 'Costs'], ['/admin/briefing', 'Briefing pack']]

// The compact top bar every screen shares: logo mark, name, navigation, the
// Trade Master pill when Cas is logged in, a link to the code on GitHub, the look
// switch, and the paper-trading notice. Under 1024px the nav row hides behind a
// Menu button (components/MainMenu.js); above it the row wraps, never scrolls.
// The header stays at the top while the page scrolls under it, one row on a phone:
// there the TRADE MASTER pill gives way to the menu's own Trade Master group.
/** @param {any} content */
export function AppLayout(content) {
  const signOut = async () => {
    if (await sessionState.logout()) go('/login')
  }

  return html`
    <div class="flex min-h-screen flex-col bg-surface">
      <header data-app-header class="sticky top-0 z-40 border-b border-line bg-surface-raised">
        <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <a href="/" class="flex min-h-11 items-center gap-2" @click="${/** @param {Event} e */ (e) => { e.preventDefault(); go('/') }}">
            <img src="/mark-terminal.svg" alt="" class="hidden h-8 w-8 dark:block" />
            <img src="/mark-daylight.svg" alt="" class="h-8 w-8 dark:hidden" />
            <span class="font-display text-lg font-bold text-fg">Market Jury</span>
          </a>

          <div class="ml-auto flex items-center gap-1">
            ${() => sessionState.tradeMaster
              ? html`<span class="hidden whitespace-nowrap rounded-full border border-brand px-2.5 py-0.5 font-mono text-xs font-semibold tracking-wide text-brand sm:inline">TRADE MASTER</span>`
              : ''}
            ${GitHubLink()}
            ${ThemeToggle()}
            ${MenuButton()}
          </div>

          <nav class="hidden w-full flex-wrap items-center gap-1 lg:flex" aria-label="Main">
            ${PUBLIC.map(([to, label]) => Link({ to, children: label, class: navItem }))}
            ${() => sessionState.tradeMaster ? html`<span class="mx-1 h-6 shrink-0 border-l border-line" aria-hidden="true"></span>${TRADE_MASTER.map(([to, label]) => Link({ to, children: label, class: navItem }))}
              <button type="button" class="inline-flex min-h-11 shrink-0 items-center rounded-control px-3 font-mono text-sm text-brand underline underline-offset-4" @click="${signOut}">Sign out</button>` : ''}
          </nav>
        </div>
      </header>
      ${MenuPanel({ links: PUBLIC, tradeMasterLinks: () => sessionState.tradeMaster ? TRADE_MASTER : null, signOut })}

      <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">${TradeMasterNotice()}${content}</main>

      <footer class="border-t border-line">
        <p class="mx-auto max-w-6xl px-4 py-4 font-mono text-xs text-fg-soft">Virtual money only. Not financial advice.</p>
      </footer>
    </div>
    ${ToastContainer()}
  `
}
