import { component, html } from '@arrow-js/core'
import { toastState }      from '../state/toastState.js'

// Toasts are raised panels; only the border says what kind. Amber is reserved
// for warnings, matching the design's Banner.
const TYPE = {
  success: 'border-line-strong bg-surface-raised text-fg',
  error:   'border-bad bg-surface-raised text-fg',
  warning: 'border-warn bg-warn-wash text-fg',
  info:    'border-line-strong bg-surface-raised text-fg',
}

export const ToastContainer = component(() =>
  html`
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      ${() => toastState.toasts.map((toast) =>
        html`
          <div
            class="${() => `pointer-events-auto flex w-80 items-start gap-3 rounded-panel border px-4 py-3 text-sm shadow-float ${TYPE[toast.type] ?? TYPE.info} ${toastState.dismissing.includes(toast.id) ? 'animate-toast-out' : 'animate-toast-in'}`}"
            role="alert"
          >
            <span class="flex-1">${toast.message}</span>
            ${toast.dismissible
              ? html`
                  <button
                    type="button"
                    class="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                    aria-label="Dismiss"
                    @click="${() => toastState.dismiss(toast.id)}"
                  >✕</button>
                `
              : ''}
          </div>
        `.key(toast.id)
      )}
    </div>
  `
)
