import { useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { SetlistManager } from './components/SetlistManager'
import { SheetEditor } from './components/SheetEditor'
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher'
import { startSync } from './lib/db'
import { startSetlistsSync } from './lib/setlistsDb'
import { startShowStateSync } from './lib/showStateDb'
import { useWorkspaceResource } from './lib/useWorkspaceResource'
import { useSetlistsStore } from './store/useSetlistsStore'
import { useShowStateStore } from './store/useShowStateStore'
import { useSongsStore } from './store/useSongsStore'
import { useWorkspaceStore } from './store/useWorkspaceStore'

type Mode = 'live' | 'edit' | 'setlists'

const MODE_LABEL: Record<Mode, string> = {
  live: 'Live',
  edit: 'Edit',
  setlists: 'Setlists',
}

function App() {
  const [mode, setMode] = useState<Mode>('live')
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)

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

  return (
    <div className="relative h-screen">
      {mode === 'live' && <Dashboard />}
      {mode === 'edit' && <SheetEditor />}
      {mode === 'setlists' && <SetlistManager />}
      <WorkspaceSwitcher />
      <div className="absolute bottom-3 right-3 z-10 flex gap-1">
        {(['live', 'edit', 'setlists'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setMode(candidate)}
            className={`rounded px-3 py-1 text-xs ${
              mode === candidate
                ? 'bg-amber-500 text-black'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
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
