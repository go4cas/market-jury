import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// The client lives in client/. `bun run build` writes dist/, which the Bun
// server serves. In dev, Vite proxies /api to the Bun server on port 3000.
export default defineConfig({
  root: 'client',
  plugins: [tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    proxy: { '/api': `http://localhost:${process.env.PORT || 3000}` },
  },
})
