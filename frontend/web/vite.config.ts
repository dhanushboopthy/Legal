import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  server: {
    proxy: {
      // Same-origin in dev, matching how nginx proxies these in prod, so
      // cookies set by the BFF are always first-party and CORS never
      // enters the picture for the browser.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // /api/ws is the event socket.
        ws: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/bff': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/bff/, ''),
      },
    },
  },
})
