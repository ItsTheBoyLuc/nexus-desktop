import '@fontsource/orbitron/latin-600.css'
import '@fontsource/orbitron/latin-700.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyMotionMode } from './lib/motion'
import './theme/global.css'
import './theme/components.css'
import './theme/layout.css'
import './theme/screens.css'
import './theme/motion.css'
import { applyTheme } from './theme/tokens'

async function start(): Promise<void> {
  // Compile-time guard: `__NEXUS_MOCK__` is replaced by the literal `false` in every Electron
  // build, so this block (and the mock module) is removed from the bundle entirely.
  if (__NEXUS_MOCK__) {
    const { installMockBridge } = await import('./mock/installMock')
    installMockBridge()
  }

  applyTheme()

  // The saved "Reduce animations" choice is applied before the first paint, so a screen never starts moving and then stops.
  const saved = await window.nexus.settings.get().catch(() => null)
  applyMotionMode(document.documentElement, saved?.reduceMotion === true)

  const container = document.getElementById('root')
  if (!container) throw new Error('Missing #root element')
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void start()
