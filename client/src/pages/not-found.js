import { html } from '@arrow-js/core'
import { useRouter } from '../composables/useRouter.js'

export const meta = { layout: 'basic', title: 'Not found · Market Jury' }

function NotFoundPage() {
  const router = useRouter()

  return html`
    <div class="text-center">
      <p class="prompt">404</p>
      <h1 class="mt-2 font-display text-2xl font-semibold text-fg">There is nothing here</h1>
      <p class="mt-2 text-sm text-fg-soft">This address doesn't match any Market Jury screen.</p>
      <button
        type="button"
        class="mt-6 inline-flex min-h-11 items-center rounded-control bg-brand px-4 font-mono text-sm font-semibold text-on-brand hover:bg-brand-hover"
        @click="${() => router.go('/')}"
      >Back to the Overview</button>
    </div>
  `
}

export default NotFoundPage
