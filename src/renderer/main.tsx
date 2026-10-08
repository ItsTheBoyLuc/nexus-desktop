import '@fontsource/orbitron/latin-600.css'
import '@fontsource/orbitron/latin-700.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './theme/global.css'
import './theme/components.css'
import { applyTheme } from './theme/tokens'

applyTheme()

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
