import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlaybackStatus } from 'shared-types'

/** Practice mode's local echo of the handful of ShowState fields the queue/transport actually
 * need - never the real, synced ShowState (useAppModeStore.ts explains why). Keyed by
 * workspace, same `byWorkspace` pattern as useActiveProfileStore.ts, so switching bands while
 * practicing doesn't point at a foreign position. */
export interface PracticeState {
  activeSetlistId: string | null
  activeEntryId: string | null
  /** Which track to play for the current entry, overriding SetlistEntry.trackId - purely a
   * personal choice here (only this device's speakers are ever affected), unlike
   * ShowState.trackOverride's Master-gated, shared equivalent for Gig mode. */
  trackOverride: string | null
  /** Force-on/off for the Click Generator (#25) during this practice session, overriding the
   * song's own `clickTrackEnabled` default - purely a personal choice here, unlike
   * ShowState.clickTrackOverride's Master-gated, shared equivalent for Gig mode. Training with
   * a fixed rhythm is exactly what solo practice is for, so this needs no gating at all. */
  clickTrackOverride: 'on' | 'off' | null
  /** How far (ms) the current entry's auto-stop point (#231) has been pushed forward by the
   * live bar-extend trigger - Practice mode's local, ungated equivalent of ShowState's
   * `clickExtendMs` (no Master-Token to gate here, same reasoning `clickTrackOverride` above
   * already documents). */
  clickExtendMs: number
  playbackStatus: PlaybackStatus
  playbackStartedAt: number | null
  playbackAccumulatedMs: number
}

export const DEFAULT_PRACTICE_STATE: PracticeState = {
  activeSetlistId: null,
  activeEntryId: null,
  trackOverride: null,
  clickTrackOverride: null,
  clickExtendMs: 0,
  playbackStatus: 'stopped',
  playbackStartedAt: null,
  playbackAccumulatedMs: 0,
}

interface PracticeStateStore {
  byWorkspace: Record<string, PracticeState>
  get: (workspaceId: string) => PracticeState
  patch: (workspaceId: string, patch: Partial<PracticeState>) => void
}

export const usePracticeStateStore = create<PracticeStateStore>()(
  persist(
    (set, get) => ({
      byWorkspace: {},
      get: (workspaceId) => get().byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE,
      patch: (workspaceId, patch) =>
        set((state) => ({
          byWorkspace: {
            ...state.byWorkspace,
            [workspaceId]: { ...(state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE), ...patch },
          },
        })),
    }),
    {
      name: 'stageboard-practice-state',
      version: 2,
      // v0 -> v1 (#25): clickTrackOverride is new. v1 -> v2 (#231): clickExtendMs is new. Every
      // read site trusts a byWorkspace entry to be a complete PracticeState (falling back to
      // DEFAULT_PRACTICE_STATE only when the whole entry is missing, not per-field) - without
      // this, a device with older persisted practice state would rehydrate `clickExtendMs:
      // undefined` (or `clickTrackOverride: undefined`, the original #25 case), which
      // effectiveClickEnabled (metronome.ts) treats as a forced-off override rather than "no
      // override", and would make useAutoStopDriver.ts's `durationMs + clickExtendMs` comparison
      // NaN, silently disabling auto-stop entirely.
      migrate: (persisted) => {
        const state = persisted as PracticeStateStore
        return {
          ...state,
          byWorkspace: Object.fromEntries(
            Object.entries(state.byWorkspace ?? {}).map(([workspaceId, practiceState]) => [
              workspaceId,
              { ...DEFAULT_PRACTICE_STATE, ...practiceState },
            ]),
          ),
        }
      },
    },
  ),
)
