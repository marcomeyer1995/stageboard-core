import { useEffect, useRef } from 'react'
import { getLocalTrackDurationMs } from './localAudioEngine'
import { useShowMode } from './showMode'

/**
 * Auto-stops playback once the current entry's backing track reaches its natural end (#231) -
 * mounted once, unconditionally, in App.tsx, same reasoning as useAudioOutputDriver.ts/
 * useClickOutputDriver.ts (a widget-local effect would stop working the moment its tab is
 * switched away from).
 *
 * Works identically in both Gig and Practice mode purely through useShowMode.ts's shared API,
 * with no explicit "is this the audio-output device" check needed: `getLocalTrackDurationMs()`
 * (localAudioEngine.ts) is naturally `null` on any Gig-mode tablet that hasn't itself loaded the
 * track - only useAudioOutputDriver.ts's claimed-output tablet ever calls `loadLocalTrack` there
 * - and Practice mode always plays locally on this exact device. Combined with `canControl`
 * (Gig's Master-Token, always-true in Practice), the auto-stop fires exactly on whichever single
 * device happens to satisfy both. The one real gap this leaves: a Gig-mode setup where Master
 * and the claimed audio output are two different tablets never auto-stops, since neither one
 * alone satisfies both conditions - the same class of limitation useAudioOutputDriver.ts's "only
 * Master forwards a load event" already has, and out of scope to solve here (it would need
 * broadcasting duration into ShowState, real cross-device plumbing this issue doesn't ask for).
 *
 * Scoped to the `manual` transition case only (#231's own scope note) - #232's `attacca` entries
 * will need to skip this and hand off into the next song instead, once that field exists. Every
 * entry today is implicitly `manual` (the only behavior that has ever existed), so no gating
 * check is needed yet.
 */
export function useAutoStopDriver(): void {
  const { elapsedMs, playbackStatus, canControl, clickExtendMs, stop } = useShowMode()

  // Guards against firing `stop()` more than once for the same play-through: `elapsedMs` keeps
  // ticking via requestAnimationFrame for a frame or two after `stop()` is called, before the
  // resulting ShowState/PracticeState change actually flips `playbackStatus` back out of
  // 'playing' - same pattern useAudioOutputDriver.ts's `audioStartedForRunRef` already uses.
  const stoppedForRunRef = useRef(false)
  useEffect(() => {
    if (playbackStatus !== 'playing') {
      stoppedForRunRef.current = false
      return
    }
    if (!canControl || stoppedForRunRef.current || elapsedMs === null) return
    const durationMs = getLocalTrackDurationMs()
    if (durationMs === null || elapsedMs < durationMs + clickExtendMs) return
    stoppedForRunRef.current = true
    void stop()
  }, [playbackStatus, canControl, elapsedMs, clickExtendMs, stop])
}
