import { component, html } from '@arrow-js/core'
import { uiState } from '../state/uiState.js'

// Switches between Terminal (dark) and Daylight (light).
export const ThemeToggle = component(() => html`
  <button
    type="button"
    aria-label="${() => uiState.mode === 'dark' ? 'Switch to Daylight' : 'Switch to Terminal'}"
    title="${() => uiState.mode === 'dark' ? 'Switch to Daylight' : 'Switch to Terminal'}"
    class="inline-flex h-11 min-w-11 items-center justify-center rounded-control px-2 font-mono text-xs font-semibold text-fg-soft hover:bg-surface-inset hover:text-fg"
    @click="${() => { uiState.mode = uiState.mode === 'light' ? 'dark' : 'light' }}"
  >${() => uiState.mode === 'dark' ? 'DAYLIGHT' : 'TERMINAL'}</button>
`)
