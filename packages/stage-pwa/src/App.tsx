import { useState } from 'react'
import { AppMenu } from './components/AppMenu'
import { BackupManager } from './components/BackupManager'
import { Dashboard } from './components/Dashboard'
import { PluginManager } from './components/PluginManager'
import { PostShowReport } from './components/PostShowReport'
import { SetlistManager } from './components/SetlistManager'
import { SheetEditor } from './components/SheetEditor'
import { startSync } from './lib/db'
import { startDashboardsSync } from './lib/dashboardsDb'
import { MODE_LABEL, type Mode } from './lib/modes'
import { startPluginsSync } from './lib/pluginsDb'
import { startProfilesSync } from './lib/profilesDb'
import { startSetlistsSync } from './lib/setlistsDb'
import { startShowLogSync } from './lib/showLogDb'
import { startShowStateSync } from './lib/showStateDb'
import { useFullscreenOnLaunch } from './lib/useFullscreen'
import { useShowLogTracker } from './lib/useShowLogTracker'
import { useWakeLock } from './lib/useWakeLock'
import { useWorkspaceResource } from './lib/useWorkspaceResource'
import { useDashboardsStore } from './store/useDashboardsStore'
import { useEditModeStore } from './store/useEditModeStore'
import { usePluginsStore } from './store/usePluginsStore'
import { useProfilesStore } from './store/useProfilesStore'
import { useSetlistsStore } from './store/useSetlistsStore'
import { useShowLogStore } from './store/useShowLogStore'
import { useShowStateStore } from './store/useShowStateStore'
import { useSongsStore } from './store/useSongsStore'
import { useWorkspaceStore } from './store/useWorkspaceStore'

function App() {
  const [mode, setMode] = useState<Mode>('live')
  const [menuOpen, setMenuOpen] = useState(false)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const isEditingDashboard = useEditModeStore((state) => state.isEditing)
  useFullscreenOnLaunch()
  useWakeLock()
  useShowLogTracker()

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
  useWorkspaceResource(
    useProfilesStore((state) => state.init),
    startProfilesSync,
    activeWorkspaceId,
  )
  useWorkspaceResource(
    useShowLogStore((state) => state.init),
    startShowLogSync,
    activeWorkspaceId,
  )

  return (
    <div className="relative h-dvh">
      {mode === 'live' && <Dashboard />}
      {mode === 'edit' && <SheetEditor />}
      {mode === 'setlists' && <SetlistManager />}
      {mode === 'plugins' && <PluginManager />}
      {mode === 'backup' && <BackupManager />}
      {mode === 'post-show' && <PostShowReport />}

      {/* Band, Theme, Fullscreen, Edit-Lock and screen navigation live behind one menu
          button, not as permanently visible controls: none of them is touched often, and
          at a real touch-target size they don't fit along one edge anyway. Hidden entirely
          while the dashboard is unlocked for editing - it used to sit exactly where a
          bottom-of-grid widget's resize handle needed to be, and the edit toolbar's own
          "Fertig" button is already the way back out. */}
      {!isEditingDashboard && (
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex h-12 items-center gap-2 rounded-sb bg-control px-4 text-base text-ink-soft hover:bg-control-hover"
          >
            <span className="text-xl leading-none">☰</span>
            {MODE_LABEL[mode]}
          </button>
        </div>
      )}

      {menuOpen && (
        <AppMenu mode={mode} onSelectMode={setMode} onClose={() => setMenuOpen(false)} />
      )}
    </div>
  )
}

export default App
