import { html, reactive, svg } from '@arrow-js/core'
import { Link } from './Link.js'
import { iconButton } from './ThemeToggle.js'

const MENU_ID = 'main-menu'
const item = 'flex min-h-12 items-center rounded-control px-3 font-mono text-[15px] text-fg-soft hover:bg-surface-inset hover:text-fg [&[aria-current=page]]:bg-brand-tint [&[aria-current=page]]:text-brand'

const ui = reactive({ open: false })

const bars = () => svg`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14"></path></svg>`
const cross = () => svg`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"></path></svg>`

/** Once the new page has drawn its heading, move focus there (the menu's link is gone). @param {string} to */
function focusHeading(to, tries = 20) {
  const h1 = /** @type {HTMLElement | null} */ (document.querySelector('main h1'))
  if (location.pathname === to && h1) {
    h1.setAttribute('tabindex', '-1')
    h1.focus({ preventScroll: true })
  } else if (tries > 0) setTimeout(() => focusHeading(to, tries - 1), 50)
}

// The Menu button for phones and tablets (under 1024px). Its panel is a popover, so
// Esc and a tap outside close it; it drops down full width just under the header.
export const MenuButton = () => html`<button type="button" class="${`${iconButton} lg:hidden`}" popovertarget="${MENU_ID}"
  aria-controls="${MENU_ID}" aria-expanded="${() => String(ui.open)}" aria-label="${() => ui.open ? 'Close menu' : 'Open menu'}" title="${() => ui.open ? 'Close menu' : 'Open menu'}"
><span class="${() => ui.open ? 'hidden' : 'contents'}">${bars()}</span><span class="${() => ui.open ? 'contents' : 'hidden'}">${cross()}</span></button>`

/**
 * @param {{ links: string[][], tradeMasterLinks: () => string[][] | null, signOut: () => void }} props
 */
export function MenuPanel({ links, tradeMasterLinks, signOut }) {
  // A navigation can redraw the layout while the menu is open; the browser then drops the
  // old panel without a toggle event, so each new panel starts closed.
  const closed = () => {
    ui.open = false
    document.documentElement.classList.remove('overflow-hidden')
  }
  closed()
  /** @param {Event} e */
  const onBeforeToggle = (e) => {
    const panel = /** @type {HTMLElement} */ (e.target)
    const opening = /** @type {ToggleEvent} */ (e).newState === 'open'
    if (opening) panel.style.setProperty('--mj-header-h', `${Math.round(document.querySelector('header')?.getBoundingClientRect().bottom ?? 61)}px`)
    ui.open = opening
    // The page behind stays put while the menu is open.
    document.documentElement.classList.toggle('overflow-hidden', opening)
  }
  /** @param {Event} e */
  const onClick = (e) => {
    const a = /** @type {HTMLElement} */ (e.target).closest('a, button')
    if (!a) return
    const panel = document.getElementById(MENU_ID)
    if (panel?.matches(':popover-open')) panel.hidePopover()
    closed()
    const to = a.getAttribute('href')
    if (to) focusHeading(to)
  }
  return html`<nav id="${MENU_ID}" popover class="mj-menu lg:hidden" aria-label="Main" @beforetoggle="${onBeforeToggle}" @click="${onClick}">
    ${links.map(([to, label]) => Link({ to, children: label, class: item }))}
    ${() => {
      const tm = tradeMasterLinks()
      return tm ? html`<p class="mj-menu__label">Trade Master</p>${tm.map(([to, label]) => Link({ to, children: label, class: item }))}
        <button type="button" class="flex min-h-12 items-center px-3 text-left font-mono text-[15px] text-brand underline underline-offset-4" @click="${signOut}">Sign out</button>` : ''
    }}
  </nav>`
}
