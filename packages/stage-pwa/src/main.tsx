import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'react-grid-layout/css/styles.css'
import './index.css'
import App from './App.tsx'
import { lockViewport } from './lib/lockViewport'
import { initTheme } from './store/useThemeStore'

initTheme()
lockViewport()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
