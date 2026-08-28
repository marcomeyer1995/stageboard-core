import { create } from 'zustand'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

/** Per-stream state as reported by trackedSync.ts's PouchDB event listeners. */
type StreamStatus = 'active' | 'paused' | 'offline' | 'error'

interface SyncState {
  /** One entry per live `.sync()` stream (songs, setlists, dashboards, ...) - see #33: there
   * is no single PouchDB sync object, so status is an aggregate across all of them. */
  streams: Record<string, StreamStatus>
  setStreamStatus: (name: string, status: StreamStatus) => void
  /** Removes a stream entirely, e.g. once it's cancelled (workspace switch) - a stopped
   * stream should stop contributing to the aggregate, not linger at its last status. */
  clearStream: (name: string) => void
}

export const useSyncStore = create<SyncState>((set) => ({
  streams: {},
  setStreamStatus: (name, status) =>
    set((state) => ({ streams: { ...state.streams, [name]: status } })),
  clearStream: (name) =>
    set((state) => {
      if (!(name in state.streams)) return state
      const streams = { ...state.streams }
      delete streams[name]
      return { streams }
    }),
}))

/**
 * Worst-signal-wins: one erroring stream means the user needs to know, even if eight
 * others are perfectly caught up. `idle` (all streams paused/caught up, or no streams at
 * all yet) doubles as the Acceptance Criteria's "Synced" state.
 */
export function deriveSyncStatus(streams: Record<string, StreamStatus>): SyncStatus {
  const values = Object.values(streams)
  if (values.some((status) => status === 'error')) return 'error'
  if (values.some((status) => status === 'offline')) return 'offline'
  if (values.some((status) => status === 'active')) return 'syncing'
  return 'idle'
}
