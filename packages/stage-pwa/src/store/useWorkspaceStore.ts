import { create } from 'zustand'
import { randomId } from '../lib/id'
import { persist } from 'zustand/middleware'

export interface Workspace {
  id: string
  name: string
}

const DEFAULT_WORKSPACES: Workspace[] = [
  { id: 'band-a', name: 'Band A' },
  { id: 'band-b', name: 'Band B' },
]

interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspaceId: string
  setActiveWorkspace: (id: string) => void
  addWorkspace: (name: string) => Workspace
}

/**
 * Which workspace (band) is active on this device. Data isolation itself lives in
 * db.ts (separate PouchDB/CouchDB databases per workspace) - this store only
 * tracks the selection, persisted so each tablet remembers its last-used band.
 */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: DEFAULT_WORKSPACES,
      activeWorkspaceId: DEFAULT_WORKSPACES[0].id,
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      addWorkspace: (name) => {
        const workspace: Workspace = { id: randomId(), name }
        set({ workspaces: [...get().workspaces, workspace], activeWorkspaceId: workspace.id })
        return workspace
      },
    }),
    { name: 'stageboard-workspaces' },
  ),
)
