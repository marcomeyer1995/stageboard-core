import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'react-grid-layout/css/styles.css'
import './index.css'
import './i18n'
import App from './App.tsx'
import { installBackGuard } from './lib/backNavigation'
import { lockViewport } from './lib/lockViewport'
import { initTheme } from './store/useThemeStore'
import { installConsoleCapture } from './lib/debugLog'
import { startLongFrameMonitor } from './lib/longFrameMonitor'

initTheme()
lockViewport()
installBackGuard()

// Live-Debug-Console (#14): mirror console output and uncaught errors into the in-app log.
installConsoleCapture()
// Long frames with their cause, when switched on (docs/26).
startLongFrameMonitor()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
