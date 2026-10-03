import './style.css'
import { provide, createApp } from './framework/index.js'
import { initRouter, beforeEach } from './framework/router.js'
import { sessionState, routeGuard } from './state/sessionState.js'

provide('app', { name: 'Market Jury', tagline: 'AI traders | 1 market | you are the jury' })

// index.html shows an "update your browser" note when the Navigation API is missing.
if ('navigation' in window) {
  await sessionState.load()
  beforeEach(({ to }) => routeGuard(to, sessionState))
  await initRouter()
  createApp()
}
