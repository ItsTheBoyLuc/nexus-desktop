import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Renderer-only dev server with a FAKE bridge (fake guilds, games, channels, announcement),
 * so every screen can be reviewed in a normal browser without a Discord login.
 *
 * Dev-server only: `vite build` with this config throws. The Electron build config
 * (electron.vite.config.ts) hard-codes __NEXUS_MOCK__ to false and refuses to run when
 * the mock flag is set, and scripts/check-no-mock.mjs re-checks the bundle.
 */
export default defineConfig(({ command }) => {
  if (command !== 'serve') {
    throw new Error('vite.mock.config.ts is for the dev server only and must never be built.')
  }
  return {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    define: { __NEXUS_MOCK__: 'true' },
    server: { host: 'localhost', port: 5174, strictPort: false, open: false }
  }
})
