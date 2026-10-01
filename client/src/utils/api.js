// Writes to the server (the Trade Master's settings and controls). Reads use
// useFetch or useApi; this is for buttons and forms.

/**
 * Send JSON and read the answer. The server's errors are plain sentences, so
 * they are passed on as they are.
 * @param {'POST' | 'PATCH'} method
 * @param {string} path
 * @param {object} [body]
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: string }>}
 */
export async function send(method, path, body = {}) {
  try {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => null)
    return res.ok ? { ok: true, data } : { ok: false, error: data?.error ?? 'The server did not accept that. Try again.' }
  } catch {
    return { ok: false, error: 'The server did not answer. Check the connection and try again.' }
  }
}
