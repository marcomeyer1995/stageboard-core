import { create } from 'zustand'

interface ClockSyncState {
  /** Correction added to Date.now() to get the synchronized master-clock time - see
   * clockSync.ts's getServerTime(). 0 before the first successful sync. */
  offsetMs: number
  /** The winning (lowest-RTT) sample's round trip time from the last successful burst -
   * null before the first successful sync. */
  rttMs: number | null
  /** Spread between the fastest and slowest RTT in the last successful burst - a rough,
   * device-local jitter reading for this tablet's own path to the Stage-Server (docs/00
   * §4). A tight burst (all samples similar) means a stable path and a trustworthy offset;
   * a wide spread means the network was noisy while syncing, so the offset is less certain
   * even though it's still the best available estimate. null before the first sync. */
  jitterMs: number | null
  /** When the last successful burst completed - null before the first one. A failed burst
   * (no Stage-Server configured, or every sample unreachable) leaves this untouched, so a
   * widget can show "how stale is this" rather than silently going blank. */
  lastSyncedAt: number | null
  setSync: (result: { offsetMs: number; rttMs: number; jitterMs: number }) => void
  reset: () => void
}

const INITIAL_STATE = {
  offsetMs: 0,
  rttMs: null,
  jitterMs: null,
  lastSyncedAt: null,
} as const

export const useClockSyncStore = create<ClockSyncState>((set) => ({
  ...INITIAL_STATE,
  setSync: ({ offsetMs, rttMs, jitterMs }) => set({ offsetMs, rttMs, jitterMs, lastSyncedAt: Date.now() }),
  reset: () => set(INITIAL_STATE),
}))
