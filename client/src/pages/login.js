import { html } from '@arrow-js/core'
import { useMeta } from '../framework/index.js'
import { useForm } from '../composables/useForm.js'
import { useRouter } from '../composables/useRouter.js'
import { sessionState } from '../state/sessionState.js'

export const meta = { layout: 'basic', title: 'Sign in · Market Jury' }

const input = 'mt-1.5 w-full min-h-11 rounded-control border border-line bg-surface-inset px-3 font-mono text-fg outline-none placeholder:text-fg-faint focus:border-brand focus:bg-surface-raised'

function LoginPage() {
  useMeta({ title: 'Sign in · Market Jury' })
  const router = useRouter()

  const { form, handleSubmit, field } = useForm(
    { password: '', code: '' },
    {
      validate: (values) => {
        const errors = /** @type {Record<string, string>} */ ({})
        if (!values.password) errors.password = 'Enter your password.'
        if (!/^\d{6}$/.test(values.code.replace(/\s/g, ''))) errors.code = 'Enter the 6-digit code from your authenticator app.'
        return errors
      },

      onSubmit: async (values) => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Sign-in failed. Try again.')
        sessionState.tradeMaster = true
        router.go('/')
      },
    },
  )

  const passwordField = field('password')
  const codeField = field('code')

  return html`
    <div>
      <div class="flex items-center gap-2">
        <img src="/mark-terminal.svg" alt="" class="hidden h-10 w-10 dark:block" />
        <img src="/mark-daylight.svg" alt="" class="h-10 w-10 dark:hidden" />
        <span class="font-display text-xl font-bold text-fg">Market Jury</span>
      </div>

      <h1 class="mt-6 font-display text-2xl font-semibold text-fg">Sign in</h1>
      <p class="mt-1 text-sm text-fg-soft">For the Trade Master. Everyone else can look around once the Gallery opens.</p>

      <form class="mt-6 space-y-4" novalidate @submit="${handleSubmit}">
        <input type="text" name="username" autocomplete="username" value="Trade Master" hidden />
        <label class="block">
          <span class="prompt">Password</span>
          <input class="${input}" type="password" name="password" autocomplete="current-password" @input="${/** @type {any} */ (passwordField.set)}" />
          ${() => (passwordField.error() ? html`<p class="mt-1.5 text-sm text-bad">${() => passwordField.error()}</p>` : '')}
        </label>

        <label class="block">
          <span class="prompt">Authenticator code</span>
          <input class="${input}" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" @input="${/** @type {any} */ (codeField.set)}" />
          ${() => (codeField.error() ? html`<p class="mt-1.5 text-sm text-bad">${() => codeField.error()}</p>` : '')}
        </label>

        ${() => (form.message ? html`<p class="text-sm text-bad" role="alert">${() => form.message}</p>` : '')}

        <button
          type="submit"
          aria-disabled="${() => form.submitting ? 'true' : 'false'}"
          class="${() => `inline-flex min-h-11 w-full items-center justify-center rounded-control bg-brand px-4 font-mono text-sm font-semibold text-on-brand ${form.submitting ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-hover'}`}"
        >${() => (form.submitting ? 'Signing in…' : 'Sign in')}</button>
      </form>
    </div>
  `
}

export default LoginPage
