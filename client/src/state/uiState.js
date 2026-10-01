import { reactive, watch } from '@arrow-js/core'

// localStorage access can throw (blocked cookies in embedded iframes, strict
// privacy modes). Fall back to defaults instead of crashing at import time.
/** @param {string} key */
function readStored(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

// One theme ("market-jury"), two modes: Terminal (dark, the default for
// everyone) and Daylight (light), which a viewer can pick.
export const uiState = reactive({
  theme: 'market-jury',
  mode: readStored('ui-mode') === 'light' ? 'light' : 'dark',
})

watch(() => {
  document.documentElement.dataset.theme = uiState.theme
  document.documentElement.dataset.mode  = uiState.mode
  try {
    localStorage.setItem('ui-mode', uiState.mode)
  } catch { /* storage unavailable: the mode still applies, it just won't persist */ }
})
