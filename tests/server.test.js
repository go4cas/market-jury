import { describe, expect, test } from 'bun:test'
import { testServer } from './helpers.js'

describe('server', () => {
  const { request } = testServer()

  test('answers the health check', async () => {
    const res = await request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('unknown API paths are a JSON 404, not the client', async () => {
    const res = await request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toHaveProperty('error')
  })

  test('serves built files as they are', async () => {
    const res = await request('/favicon.svg')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<svg')
  })

  test('serves index.html for client routes so the router can take over', async () => {
    for (const path of ['/', '/assets', '/standings', '/traders/3', '/admin/settings']) {
      const res = await request(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('<title>Market Jury</title>')
    }
  })

  test('never serves files outside the client folder', async () => {
    const res = await request('/%2e%2e/%2e%2e/etc/passwd')
    expect(await res.text()).toContain('<title>Market Jury</title>')
  })

  test('sends basic security headers', async () => {
    const res = await request('/')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    // Only this site's own scripts run: no inline scripts, nothing from elsewhere.
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self';")
  })
})
