import { create } from 'zustand'

interface LocalAudioOutputState {
  error: string | null
  /** True once an automatic (gestureless) `playLocalTrack` call - useAudioOutputDriver.ts's
   * reload-time auto-resume - has been rejected by the browser's autoplay policy. Separate from
   * `error`: this isn't a load failure, it's a call the driver will never retry on its own (its
   * own "already started this run" bookkeeping doesn't distinguish a genuine start from a
   * rejected one), so ShowTransportWidget.tsx needs it to show an actionable "tap to resume"
   * control instead of just the passive error text `error` gets. */
  audioBlocked: boolean
}

/** This tablet's own local-<audio>-output state, set by useAudioOutputDriver.ts, which (unlike
 * the ShowTransportWidget.tsx it used to live in) runs unconditionally regardless of which
 * top-level tab (Live/Bibliothek/System) is showing, so the actual playback engine never stops
 * just because the widget displaying it isn't currently mounted (found live, 2026-09-10). This
 * tiny store is how ShowTransportWidget reads that driver's state back for display whenever it
 * does happen to be mounted, without re-running the load/play itself (a second hook call site
 * would duplicate the side effect, not just read state). */
export const useLocalAudioOutputStore = create<LocalAudioOutputState>(() => ({
  error: null,
  audioBlocked: false,
}))
