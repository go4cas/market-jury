import { component, html, svg } from '@arrow-js/core'
import { uiState } from '../state/uiState.js'

export const iconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-fg-soft hover:bg-surface-inset hover:text-fg'

// The design system's HeaderActions icons: 20px line icons, stroke 1.6.
const sun = () => svg`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="3.5"></circle><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M4 16l1.4-1.4M14.6 5.4L16 4"></path></svg>`
const moon = () => svg`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z"></path></svg>`

// Switches between Terminal (dark) and Daylight (light), showing the look it switches to:
// a sun in Terminal, a moon in Daylight.
export const ThemeToggle = component(() => {
  const label = () => uiState.mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  return html`<button type="button" aria-label="${label}" title="${label}" class="${iconButton}"
    @click="${() => { uiState.mode = uiState.mode === 'light' ? 'dark' : 'light' }}"
  ><span class="hidden dark:contents">${sun()}</span><span class="contents dark:hidden">${moon()}</span></button>`
})
