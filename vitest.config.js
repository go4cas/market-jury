import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['client/tests/**/*.test.js'],
    exclude: [...configDefaults.exclude, 'client/tests/e2e/**'],
    environment: 'jsdom',
    setupFiles: ['client/tests/setup.js'],
  },
})
