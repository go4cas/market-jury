import { join, resolve, sep } from 'node:path'
import { createAlpaca } from '../market/alpaca.js'
import { adminRoutes } from './admin.js'
import { authRoutes, isTradeMaster } from './auth.js'
import { config } from './config.js'
import { json, error, withSecurityHeaders } from './http.js'
import { readRoutes } from './reads.js'

/** @typedef {import('bun:sqlite').Database} Database */

/**
 * Start the HTTP server: the JSON API under /api and the built client for
 * every other path.
 * @param {object} options
 * @param {Database} options.db
 * @param {number} options.port 0 picks a free port (tests)
 * @param {string} options.clientDir folder holding the built client (index.html)
 * @param {() => number} [options.now]
 * @param {import('../jobs/schedule.js').StepContext} [options.steps] what the scheduler and dry run use (tests pass fakes)
 */
export function startServer({ db, port, clientDir, now, steps }) {
  const root = resolve(clientDir)
  const context = steps ?? { db, now: () => new Date(now ? now() : Date.now()), alpaca: createAlpaca(config.alpaca) }

  return Bun.serve({
    port,
    routes: {
      '/api/health': () => json({ ok: true }),

      // What the client needs before routing: who is looking, and whether the
      // public Gallery is open.
      '/api/session': (req) => {
        const settings = /** @type {{ gallery_enabled: number }} */ (db.query('SELECT gallery_enabled FROM settings WHERE id = 1').get())
        return json({ tradeMaster: isTradeMaster(db, req), galleryEnabled: settings.gallery_enabled === 1 })
      },

      ...authRoutes(db, { now }),
      ...adminRoutes(context),
      ...readRoutes(context),

      '/api/*': () => error(404, 'There is nothing at this address.'),
    },

    // The built client: real files as they are, every other path gets
    // index.html so the client-side router can take over.
    async fetch(req) {
      const { pathname } = new URL(req.url)
      const path = join(root, decodeURIComponent(pathname))
      if (path.startsWith(root + sep)) {
        const file = Bun.file(path)
        if (await file.exists()) return withSecurityHeaders(new Response(file))
      }
      const index = Bun.file(join(root, 'index.html'))
      if (!(await index.exists())) return error(503, 'The client is not built yet. Run `bun run build`.')
      return withSecurityHeaders(new Response(index, { headers: { 'Content-Type': 'text/html;charset=utf-8' } }))
    },

    error(err) {
      console.error(err)
      return error(500, 'Something went wrong on the server.')
    },
  })
}
