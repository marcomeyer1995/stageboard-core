import { create } from 'zustand'

interface ClockSyncState {
  /** Correction added to Date.now() to get the synchronized master-clock time - see
   * clockSync.ts's getServerTime(). 0 before the first successful sync. */
  offsetMs: number
  /** The winning (lowest-RTT) sample's round trip time from the last successful burst -
   * null before the first successful sync. */
  rttMs: number | null
  /** Spread between the fastest and slowest RTT in the last successful burst - a raw,
   * per-burst diagnostic (docs/00 §4), NOT a trustworthy signal for whether the *offset*
   * itself is right (see `driftMs` below for that - confirmed live against real devices on
   * noisy WiFi, #31 follow-up: this number can swing from tens to hundreds of ms purely from
   * one rare slow sample, while the actually-used offset barely moves). Kept around for
   * debugging a specific sync, not for driving any status indicator. null before the first
   * sync. */
  jitterMs: number | null
  /** Spread between the newest and oldest offset in a short trailing window of recent
   * successful bursts (`clockSync.ts`'s `OFFSET_HISTORY_SIZE`, currently 5 - about 5 minutes
   * at the 60s resync interval) - this, not `jitterMs`, is what actually indicates whether the
   * synced offset can be trusted: a burst's own lowest-RTT sample is already a robust estimate
   * on its own (min-RTT selection filters out the noisy samples), so what would actually mean
   * trouble is that estimate *moving* between syncs - a real Stage-Server clock jump or a
   * genuinely drifting device, not one noisy burst. null until at least 2 syncs have
   * completed (nothing to compare yet). */
  driftMs: number | null
  /** When the last successful burst completed - null before the first one. A failed burst
   * (no Stage-Server configured, or every sample unreachable) leaves this untouched, so a
   * widget can show "how stale is this" rather than silently going blank. */
  lastSyncedAt: number | null
  setSync: (result: { offsetMs: number; rttMs: number; jitterMs: number; driftMs: number | null }) => void
  reset: () => void
}

const INITIAL_STATE = {
  offsetMs: 0,
  rttMs: null,
  jitterMs: null,
  driftMs: null,
  lastSyncedAt: null,
} as const

export const useClockSyncStore = create<ClockSyncState>((set) => ({
  ...INITIAL_STATE,
  setSync: ({ offsetMs, rttMs, jitterMs, driftMs }) => set({ offsetMs, rttMs, jitterMs, driftMs, lastSyncedAt: Date.now() }),
  reset: () => set(INITIAL_STATE),
}))
