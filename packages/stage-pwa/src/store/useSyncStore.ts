import { create } from 'zustand'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

/** Per-stream state as reported by trackedSync.ts's PouchDB event listeners. */
type StreamStatus = 'active' | 'paused' | 'offline' | 'error'

export interface StreamProgress {
  /** Changes CouchDB says are still left to pull for this stream, right now. */
  pending: number
  /** The highest `pending` seen since this stream's progress was last cleared - the
   * denominator for "how far through this run are we." Grows instead of resetting if new
   * changes show up mid-sync, so the percentage dips rather than lying about being done. */
  initialPending: number
}

interface SyncState {
  /** One entry per live `.sync()` stream (songs, setlists, dashboards, ...) - see #33: there
   * is no single PouchDB sync object, so status is an aggregate across all of them. */
  streams: Record<string, StreamStatus>
  setStreamStatus: (name: string, status: StreamStatus) => void
  /** Removes a stream entirely, e.g. once it's cancelled (workspace switch) - a stopped
   * stream should stop contributing to the aggregate, not linger at its last status. */
  clearStream: (name: string) => void
  /**
   * Pull-direction progress, tracked separately from `streams` (see trackedSync.ts's #49
   * follow-up) - only CouchDB's `_changes` feed (2.0+) reports a `pending` count, and only
   * for the pull direction (push reads from the local IndexedDB adapter, which doesn't), so
   * not every stream will ever have an entry here.
   */
  progress: Record<string, StreamProgress>
  setStreamProgress: (name: string, pending: number) => void
  /** Called whenever a stream settles (paused/offline/error/cancelled) - a finished run's
   * totals must not bleed into the next one's percentage. */
  clearStreamProgress: (name: string) => void
  /**
   * Mirrors the browser's own `online`/`offline` events (set by useBrowserOnlineStatus.ts,
   * mounted once in App.tsx) - a *separate* signal from `streams` below. Found live,
   * 2026-09-10: switching off a tablet's WiFi left the indicator green for a long time,
   * because nothing here reacted until PouchDB's live `_changes` connection actually noticed
   * its request failed - which, for an idle long-poll connection with no clean disconnect to
   * react to, means waiting on a TCP-level timeout that can take minutes. The browser/OS knows
   * the network interface went down almost immediately; this field lets that fact short-circuit
   * `deriveSyncStatus` below without waiting for any stream to personally notice.
   */
  browserOffline: boolean
  setBrowserOffline: (offline: boolean) => void
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
  progress: {},
  setStreamProgress: (name, pending) =>
    set((state) => {
      const previous = state.progress[name]
      return {
        progress: {
          ...state.progress,
          [name]: { pending, initialPending: Math.max(previous?.initialPending ?? 0, pending) },
        },
      }
    }),
  clearStreamProgress: (name) =>
    set((state) => {
      if (!(name in state.progress)) return state
      const progress = { ...state.progress }
      delete progress[name]
      return { progress }
    }),
  // `navigator.onLine` defaults true in an environment that doesn't support it at all,
  // matching the same "assume online until told otherwise" fallback the offline/online
  // events themselves degrade to on such a browser (they simply never fire).
  browserOffline: typeof navigator !== 'undefined' && 'onLine' in navigator ? !navigator.onLine : false,
  setBrowserOffline: (offline) => set({ browserOffline: offline }),
}))

/**
 * Worst-signal-wins: one erroring stream means the user needs to know, even if eight
 * others are perfectly caught up. `idle` (all streams paused/caught up, or no streams at
 * all yet) doubles as the Acceptance Criteria's "Synced" state.
 *
 * `browserOffline` (see that field's own doc comment) short-circuits everything else: the
 * browser/OS reporting no network at all is a stronger, faster signal than waiting for any
 * individual PouchDB stream to notice its own connection died. Checked before even `error`,
 * since a stream that errored while still connected is a different, more specific problem
 * than "there is currently no network" - the latter is what the user actually needs to see
 * and act on (reconnect WiFi) once both are true at once.
 */
export function deriveSyncStatus(streams: Record<string, StreamStatus>, browserOffline = false): SyncStatus {
  if (browserOffline) return 'offline'
  const values = Object.values(streams)
  if (values.some((status) => status === 'error')) return 'error'
  if (values.some((status) => status === 'offline')) return 'offline'
  if (values.some((status) => status === 'active')) return 'syncing'
  return 'idle'
}

/**
 * Aggregate "how far through the current pull(s)" percentage across every stream that has
 * reported one, or `null` when none has yet (an older CouchDB, streams that are all
 * caught-up/push-only right now, or nothing pending) - the indicator falls back to a plain
 * "Synchronisiere…" in that case instead of a fake or stuck-looking percentage.
 */
export function deriveSyncProgress(progress: Record<string, StreamProgress>): number | null {
  const entries = Object.values(progress).filter((p) => p.initialPending > 0)
  if (entries.length === 0) return null
  const totalInitial = entries.reduce((sum, p) => sum + p.initialPending, 0)
  const totalDone = entries.reduce((sum, p) => sum + (p.initialPending - p.pending), 0)
  return Math.round((totalDone / totalInitial) * 100)
}
