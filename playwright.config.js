import { defineConfig } from '@playwright/test'

const PORT = 4173

// End-to-end tests run the real thing: the Bun server with a throwaway
// database, serving the built client (see client/tests/e2e/server.js).
export default defineConfig({
  testDir: './client/tests/e2e',
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Use a preinstalled Chromium when the environment provides one.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'bun run build && bun client/tests/e2e/server.js',
    url: `http://localhost:${PORT}/api/health`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
  },
})
