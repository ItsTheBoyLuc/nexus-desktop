import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'electron-vite'
import type { Plugin } from 'vite'
import { buildProductionCsp } from './src/shared/csp'

const DEFAULT_API_BASE_URL = 'https://discord-template-bot-h60d.onrender.com'

// The mock bridge is for browser review only (`npm run dev:mock`). It must never be
// reachable from an Electron build, so any attempt to turn it on here is fatal.
if (process.env.NEXUS_MOCK === '1' || process.env.VITE_USE_MOCK === 'true') {
  throw new Error('Refusing to run electron-vite with the mock bridge enabled (NEXUS_MOCK / VITE_USE_MOCK).')
}

/** Inject the strict production CSP as a <meta> tag (file:// pages get no response headers). */
function productionCsp(): Plugin {
  return {
    name: 'nexus-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${buildProductionCsp()}" />`
      return html.replace('<!--nexus-csp-->', meta)
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiBaseUrl = (env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '')
  if (!/^https:\/\/[^/\s]+$/i.test(apiBaseUrl)) {
    throw new Error('VITE_API_BASE_URL must be an https origin without a path, e.g. https://example.onrender.com')
  }

  return {
    main: {
      define: { __API_BASE_URL__: JSON.stringify(apiBaseUrl) },
      build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
    },
    preload: {
      build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
    },
    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      define: { __NEXUS_MOCK__: 'false' },
      plugins: [react(), productionCsp()],
      build: {
        // Fonts/images must stay real files: the CSP has no `data:` in font-src.
        assetsInlineLimit: 0,
        minify: 'esbuild',
        rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
      }
    }
  }
})
