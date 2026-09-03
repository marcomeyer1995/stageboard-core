import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SessionMode = 'gig' | 'practice'

interface AppModeState {
  mode: SessionMode
  setMode: (mode: SessionMode) => void
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
    (set) => ({
      mode: 'gig',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'stageboard-app-mode' },
  ),
)
