import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AudioPinsState {
  /** Keyed by workspace, same reasoning as useAudioSyncStore - a pin only means "always keep
   * this song's audio offline on this device," which doesn't carry over between bands. */
  byWorkspace: Record<string, string[]>
  pinsFor: (workspaceId: string) => string[]
  togglePin: (workspaceId: string, songId: string) => void
}

// A shared, stable reference for "no pins yet" - returning a fresh `[]` literal from pinsFor
// would give useSyncExternalStore a new snapshot on every single call even when nothing
// changed, which reads as "always changed" and causes an infinite re-render loop (confirmed
// live: "Maximum update depth exceeded" from LibraryView, which calls pinsFor every render).
const NO_PINS: string[] = []

/**
 * Songs manually marked "always keep cached," independent of the active setlist - what
 * "Selective" sync mode caches on top of the active setlist (audioStorageManager.ts).
 * Device-local, not synced: the same distinction as useAudioSyncStore.
 */
export const useAudioPinsStore = create<AudioPinsState>()(
  persist(
    (set, get) => ({
      byWorkspace: {},
      pinsFor: (workspaceId) => get().byWorkspace[workspaceId] ?? NO_PINS,
      togglePin: (workspaceId, songId) => {
        const current = get().byWorkspace[workspaceId] ?? []
        const next = current.includes(songId)
          ? current.filter((id) => id !== songId)
          : [...current, songId]
        set({ byWorkspace: { ...get().byWorkspace, [workspaceId]: next } })
      },
    }),
    { name: 'stageboard-audio-pins' },
  ),
)
