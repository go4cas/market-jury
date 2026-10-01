import { reactive } from '@arrow-js/core'

/**
 * @typedef {object} Session
 * @property {boolean} tradeMaster  the logged-in Trade Master (Cas) is looking
 * @property {boolean} galleryEnabled  the public, read-only Gallery is open
 */

export const sessionState = reactive({
  tradeMaster: false,
  galleryEnabled: false,

  /** Ask the server who is looking. Called once before the router starts. */
  async load() {
    try {
      const res = await fetch('/api/session')
      if (!res.ok) return
      const session = /** @type {Session} */ (await res.json())
      this.tradeMaster = session.tradeMaster
      this.galleryEnabled = session.galleryEnabled
    } catch { /* server unreachable: stay logged out */ }
  },

  async logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    this.tradeMaster = false
  },
})

/**
 * Where a visitor may go. Trade Master screens live under /admin; every other
 * screen is public only while the Gallery is open. Returns the path to send
 * the visitor to instead, or undefined to let them through.
 * @param {string} to
 * @param {Session} session
 * @returns {string | undefined}
 */
export function routeGuard(to, { tradeMaster, galleryEnabled }) {
  if (to === '/login') return tradeMaster ? '/' : undefined
  if (tradeMaster) return undefined
  if (to === '/admin' || to.startsWith('/admin/')) return '/login'
  return galleryEnabled ? undefined : '/login'
}
