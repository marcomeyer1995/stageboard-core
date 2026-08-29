import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AudioSyncMode = 'none' | 'selective' | 'full'

const DEFAULT_MODE: AudioSyncMode = 'selective'

interface AudioSyncState {
  /** Keyed by workspace, same reasoning as useActiveDashboardStore: this tablet's chosen
   * offline-audio strategy for one band has nothing to do with another band's. */
  byWorkspace: Record<string, AudioSyncMode>
  modeFor: (workspaceId: string) => AudioSyncMode
  setMode: (workspaceId: string, mode: AudioSyncMode) => void
}

/**
 * Which audio-caching strategy this device uses for a workspace - device-local like
 * useActiveDashboardStore, not synced: a "viewer" tablet backstage and the singer's
 * performing tablet can reasonably want different strategies for the same band.
 */
export const useAudioSyncStore = create<AudioSyncState>()(
  persist(
    (set, get) => ({
      byWorkspace: {},
      modeFor: (workspaceId) => get().byWorkspace[workspaceId] ?? DEFAULT_MODE,
      setMode: (workspaceId, mode) =>
        set({ byWorkspace: { ...get().byWorkspace, [workspaceId]: mode } }),
    }),
    { name: 'stageboard-audio-sync-mode' },
  ),
)
