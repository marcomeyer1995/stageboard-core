import { useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { EditLock } from './components/EditLock'
import { PluginManager } from './components/PluginManager'
import { SetlistManager } from './components/SetlistManager'
import { SheetEditor } from './components/SheetEditor'
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher'
import { startSync } from './lib/db'
import { startDashboardsSync } from './lib/dashboardsDb'
import { startPluginsSync } from './lib/pluginsDb'
import { startSetlistsSync } from './lib/setlistsDb'
import { startShowStateSync } from './lib/showStateDb'
import { useWorkspaceResource } from './lib/useWorkspaceResource'
import { useDashboardsStore } from './store/useDashboardsStore'
import { usePluginsStore } from './store/usePluginsStore'
import { useSetlistsStore } from './store/useSetlistsStore'
import { useShowStateStore } from './store/useShowStateStore'
import { useSongsStore } from './store/useSongsStore'
import { useThemeStore } from './store/useThemeStore'
import { useWorkspaceStore } from './store/useWorkspaceStore'

type Mode = 'live' | 'edit' | 'setlists' | 'plugins'

const MODE_LABEL: Record<Mode, string> = {
  live: 'Live',
  edit: 'Songs',
  setlists: 'Setlists',
  plugins: 'Plugins',
}

function App() {
  const [mode, setMode] = useState<Mode>('live')
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const theme = useThemeStore((state) => state.theme)
  const toggleTheme = useThemeStore((state) => state.toggle)

  useWorkspaceResource(useSongsStore((state) => state.init), startSync, activeWorkspaceId)
  useWorkspaceResource(
    useSetlistsStore((state) => state.init),
    startSetlistsSync,
    activeWorkspaceId,
  )
  useWorkspaceResource(
    useShowStateStore((state) => state.init),
    startShowStateSync,
    activeWorkspaceId,
  )
  useWorkspaceResource(
    usePluginsStore((state) => state.init),
    startPluginsSync,
    activeWorkspaceId,
  )
  useWorkspaceResource(
    useDashboardsStore((state) => state.init),
    startDashboardsSync,
    activeWorkspaceId,
  )

  return (
    <div className="relative h-screen">
      {mode === 'live' && <Dashboard />}
      {mode === 'edit' && <SheetEditor />}
      {mode === 'setlists' && <SetlistManager />}
      {mode === 'plugins' && <PluginManager />}
      <WorkspaceSwitcher />
      <div className="absolute bottom-3 right-3 z-10 flex gap-1">
        {mode === 'live' && <EditLock />}
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          className="rounded bg-control px-3 py-1 text-xs text-ink-soft hover:bg-control-hover"
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        {(['live', 'edit', 'setlists', 'plugins'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setMode(candidate)}
            className={`rounded px-3 py-1 text-xs ${
              mode === candidate
                ? 'bg-amber-500 text-black'
                : 'bg-control text-ink-soft hover:bg-control-hover'
            }`}
          >
            {MODE_LABEL[candidate]}
          </button>
        ))}
      </div>
    </div>
  )
}

export default App
