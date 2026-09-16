import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { stopClick } from '../lib/clickEngine'
import { unloadLocalTrack } from '../lib/localAudioEngine'
import { usePracticeStateStore } from './usePracticeStateStore'
import { useShowStateStore } from './useShowStateStore'
import { useWorkspaceStore } from './useWorkspaceStore'

export type SessionMode = 'gig' | 'practice'

interface AppModeState {
  mode: SessionMode
  /** Returns whether the switch actually happened - `false` means it was refused because a
   * song is currently playing in `sessionMode`'s own current mode (see the guard below).
   * SessionModeControl.tsx doesn't strictly need this (it already disables the button whenever
   * that's the case), but callers that don't pre-check for themselves still get a clear signal
   * instead of a silent no-op. */
  setMode: (mode: SessionMode) => boolean
}

/** Whether `sessionMode`'s own transport is actively playing right now - read via `getState()`
 * rather than a hook, since `setMode` is a plain store action, not a component. Mirrors
 * showMode.ts's `useShowMode()` branching (Gig mode: the shared ShowState; Practice mode: this
 * device's own per-workspace echo), just without the React subscription that hook needs. */
function isModePlaying(sessionMode: SessionMode): boolean {
  if (sessionMode === 'gig') {
    return useShowStateStore.getState().state.playbackStatus === 'playing'
  }
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId
  return usePracticeStateStore.getState().get(workspaceId).playbackStatus === 'playing'
}

/**
 * Gig vs. Practice, per-device (not per-workspace: it's about whether *this tablet* is being
 * used live right now, same immediate-physical-context nature as which dashboard is showing -
 * docs/07 §2 - not which band it's currently pointed at). Deliberately not `Mode` from
 * modes.ts, which is unrelated: that's "which top-level screen" (Live/Bibliothek/System), this
 * is "does this device's queue/transport touch the shared, synced ShowState at all."
 *
 * Gig mode (default): NextSongWidget/ShowTransportWidget read and write the real, synced
 * ShowState - unchanged from before this existed. Audio only ever comes from a Stage-Server
 * plugin; a dropped connection shows as disconnected, never silently falls back to this
 * device's own speaker (a random tablet suddenly blasting audio mid-show would be worse than
 * no audio at all).
 *
 * Practice mode: the same widgets instead read/write a purely local echo (usePracticeStore.ts)
 * - never the shared ShowState, never the shared ShowLog - so practicing alone can't hijack
 * the live show's current song for the rest of the band or pollute the real Nachbericht.
 * Audio always plays through this device's own speakers/headphones (localAudioEngine.ts) -
 * unambiguous, since there is no shared rig to speak of in this mode at all.
 */
export const useAppModeStore = create<AppModeState>()(
  persist(
    (set, get) => ({
      mode: 'gig',
      setMode: (mode) => {
        const current = get().mode
        if (mode === current) return true
        // Safety feature (Marco, explicit request): switching Gig <-> Solo Üben mid-song risks
        // yanking whatever's actually making sound - the band's live rig in Gig mode, this
        // device's own speaker in Practice mode - out from under an active song. Block the
        // switch outright rather than just cleaning up after it, unlike the leaving-Practice
        // cleanup below.
        if (isModePlaying(current)) return false
        // Leaving Practice mode must never leave its local-only playback running into Gig mode -
        // Practice's Play/Pause/Stop (practiceQueue.ts) drives localAudioEngine.ts imperatively,
        // entirely decoupled from ShowTransportWidget's own Gig-mode-only "stop when no longer
        // the claimed output" effect (isMyDeviceAudioOutput), so nothing else would otherwise
        // ever tell it to stop (found live, 2026-09-10: a Solo-mode backing track kept audibly
        // playing after switching to Gig mode). stopClick() is the same story for the Click
        // Generator's Practice-mode override (#25) - both are no-ops if nothing was playing.
        if (current === 'practice' && mode !== 'practice') {
          unloadLocalTrack()
          stopClick()
        }
        set({ mode })
        return true
      },
    }),
    { name: 'stageboard-app-mode' },
  ),
)
