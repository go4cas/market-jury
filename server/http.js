// Small helpers shared by the API routes.

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Scripts, data, fonts and images from this site only. Inline styles stay
  // allowed because templates set a few style attributes; inline scripts do not.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
}

/**
 * @param {unknown} body
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
export function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers },
  })
}

/**
 * Plain-language error in the shape the client shows.
 * @param {number} status
 * @param {string} message
 */
export function error(status, message) {
  return json({ error: message }, status)
}

/**
 * Parse a JSON body. Requiring application/json also means a plain HTML form
 * on another site can't post here (on top of the SameSite=Strict cookie).
 * @param {Request} req
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readJson(req) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) return null
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? /** @type {Record<string, unknown>} */ (body) : null
  } catch {
    return null
  }
}

/** @param {Response} res */
export function withSecurityHeaders(res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(key, value)
  return res
}
