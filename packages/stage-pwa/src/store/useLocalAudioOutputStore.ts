import { create } from 'zustand'

interface LocalAudioOutputState {
  error: string | null
}

/** This tablet's own local-<audio>-output load error, if any - set by
 * useAudioOutputDriver.ts, which (unlike the ShowTransportWidget.tsx it used to live in) runs
 * unconditionally regardless of which top-level tab (Live/Bibliothek/System) is showing, so the
 * actual playback engine never stops just because the widget displaying it isn't currently
 * mounted (found live, 2026-09-10). This tiny store is how ShowTransportWidget reads that
 * driver's error back for display whenever it does happen to be mounted, without re-running the
 * load itself (a second hook call site would duplicate the side effect, not just read state). */
export const useLocalAudioOutputStore = create<LocalAudioOutputState>(() => ({ error: null }))
