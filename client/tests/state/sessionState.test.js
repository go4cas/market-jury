import { describe, it, expect, vi, afterEach } from 'vitest'
import { routeGuard, sessionState } from '../../src/state/sessionState.js'
import { toastState } from '../../src/state/toastState.js'

describe('sessionState.logout', () => {
  afterEach(() => { vi.unstubAllGlobals(); toastState.toasts.splice(0) })

  it('clears the session only once the server confirms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    sessionState.tradeMaster = true
    expect(await sessionState.logout()).toBe(true)
    expect(sessionState.tradeMaster).toBe(false)
  })

  it('stays signed in and says so when the server fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    sessionState.tradeMaster = true
    expect(await sessionState.logout()).toBe(false)
    expect(sessionState.tradeMaster).toBe(true)
    expect(toastState.toasts.at(-1)?.type).toBe('error')
  })

  it('stays signed in when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    sessionState.tradeMaster = true
    expect(await sessionState.logout()).toBe(false)
    expect(sessionState.tradeMaster).toBe(true)
  })
})

const visitor = { tradeMaster: false, galleryEnabled: false }
const galleryVisitor = { tradeMaster: false, galleryEnabled: true }
const tradeMaster = { tradeMaster: true, galleryEnabled: false }

describe('routeGuard', () => {
  it('sends visitors to the login page while the Gallery is closed', () => {
    expect(routeGuard('/', visitor)).toBe('/login')
    expect(routeGuard('/standings', visitor)).toBe('/login')
  })

  it('lets anyone see the login page', () => {
    expect(routeGuard('/login', visitor)).toBeUndefined()
  })

  it('lets visitors read public screens once the Gallery is open', () => {
    expect(routeGuard('/', galleryVisitor)).toBeUndefined()
    expect(routeGuard('/standings', galleryVisitor)).toBeUndefined()
  })

  it('keeps Trade Master screens closed to visitors, Gallery or not', () => {
    expect(routeGuard('/admin', galleryVisitor)).toBe('/login')
    expect(routeGuard('/admin/settings', galleryVisitor)).toBe('/login')
  })

  it('does not treat a lookalike path as an admin screen', () => {
    expect(routeGuard('/administrator', galleryVisitor)).toBeUndefined()
  })

  it('lets the Trade Master go anywhere, and skips the login page', () => {
    expect(routeGuard('/', tradeMaster)).toBeUndefined()
    expect(routeGuard('/admin/settings', tradeMaster)).toBeUndefined()
    expect(routeGuard('/login', tradeMaster)).toBe('/')
  })
})
