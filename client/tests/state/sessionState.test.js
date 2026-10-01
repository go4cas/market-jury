import { describe, it, expect } from 'vitest'
import { routeGuard } from '../../src/state/sessionState.js'

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
