import { reactive, watch } from '@arrow-js/core'
import { onLeave } from '../framework/lifecycle.js'

/**
 * Like useFetch, for an address that changes: give it a function that builds
 * the URL from reactive state, and it fetches again whenever that URL changes.
 * The latest request wins; an older answer that arrives late is dropped.
 * An empty URL waits without fetching. error() holds the server's own plain-language message when it sent one.
 * @param {() => string} url
 * @returns {{ data: () => any, loading: () => boolean, error: () => string | null, status: () => number | null, refetch: () => Promise<void> }}
 */
export function useApi(url) {
  const state = reactive(
    /** @type {{ data: any, loading: boolean, error: string | null, status: number | null }} */
    ({ data: null, loading: false, error: null, status: null })
  )
  /** @type {AbortController | null} */
  let controller = null
  let current = ''

  async function execute() {
    controller?.abort()
    const own = new AbortController()
    controller = own
    state.loading = true
    state.error = null
    try {
      const res = await fetch(current, { signal: own.signal })
      if (controller !== own) return
      state.status = res.status
      const body = await res.json().catch(() => null)
      if (controller !== own) return
      // The server's errors are plain sentences meant for the reader.
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      state.data = body
    } catch (err) {
      const e = /** @type {Error} */ (err)
      if (controller === own && e.name !== 'AbortError') {
        state.data = null
        state.error = e.message
      }
    } finally {
      if (controller === own) state.loading = false
    }
  }

  const [, stop] = watch(url, (next) => {
    if (next === current) return
    current = next
    if (next) execute()
  })
  onLeave(() => { stop(); controller?.abort() })

  return {
    data: () => state.data,
    loading: () => state.loading,
    error: () => state.error,
    status: () => state.status,
    refetch: execute,
  }
}
