import { useEffect, useRef, useSyncExternalStore } from 'react'
import { CAPABILITIES } from 'shared-types'
import { startClick, stopClick, type ClickEngineState } from './clickEngine'
import { getLoopPlaybackState } from './loopTrainerEngine'
import { adjustedBpm, effectiveClickEnabled } from './metronome'
import { useCapabilityRouting } from './useCapabilityRouting'
import { useShowMode } from './showMode'
import { useLoopTrainerStore } from '../store/useLoopTrainerStore'

/** `visibilitychange` alone isn't reliable enough here - iOS Safari (including standalone/
 * home-screen PWA mode, StageBoard's actual install path) has a history of firing it late or not
 * at all on an app-switch (found live, 2026-09-10: switching to another app on a tablet still
 * produced sporadic ticks even with the visibilitychange-only version of this check). `blur`/
 * `focus` and `document.hasFocus()` are the older, more universally-supported DOM APIs and catch
 * the OS-level "this app lost focus" transition that app-switching actually is, independent of
 * whatever the Page Visibility API reports on a given platform. `pagehide`/`pageshow` cover the
 * bfcache-eviction edge case neither of the others does. */
function subscribeToVisibility(callback: () => void): () => void {
  document.addEventListener('visibilitychange', callback)
  window.addEventListener('blur', callback)
  window.addEventListener('focus', callback)
  window.addEventListener('pagehide', callback)
  window.addEventListener('pageshow', callback)
  return () => {
    document.removeEventListener('visibilitychange', callback)
    window.removeEventListener('blur', callback)
    window.removeEventListener('focus', callback)
    window.removeEventListener('pagehide', callback)
    window.removeEventListener('pageshow', callback)
  }
}

function isPageVisibleSnapshot(): boolean {
  return document.visibilityState !== 'hidden' && document.hasFocus()
}

/** The slice of ClickEngineState a running Rehearsal Loop (#61) contributes - nothing otherwise. */
function loopClickState(loopActive: boolean): Pick<ClickEngineState, 'playbackRate' | 'loop'> {
  const loop = loopActive ? getLoopPlaybackState() : null
  return loop ? { playbackRate: loop.rate, loop: { startMs: loop.startMs, endMs: loop.endMs } } : { playbackRate: 1, loop: null }
}

/**
 * Drives the Click Generator's Web Audio scheduler (#25, clickEngine.ts) regardless of which
 * top-level tab (Live/Bibliothek/System, modes.ts) is currently showing - mounted once,
 * unconditionally, in App.tsx. Same reasoning and same bug as useAudioOutputDriver.ts: this used
 * to live inside ClickTrackWidget.tsx's own effect, so switching away from the Live tab unmounted
 * the widget and, via the effect's cleanup, silently stopped the click mid-show. ClickTrackWidget
 * still owns the status/override UI and re-derives the same `useCapabilityRouting` (#148) purely
 * for display - only the actual startClick/stopClick calls live here, exactly once.
 *
 * `shouldPlay` below only ever cares whether `engine === 'local-mine'` - this tab's own Web
 * Audio is the right output *only* when this specific tablet is the bound device; a plugin/
 * server-routed capability is produced by that plugin's own hardware instead, nothing this
 * hook should schedule locally. So unlike ClickTrackWidget.tsx's identical-shaped bug, this
 * hook's own former hand-rolled `pluginId: null` was behaviorally inert here (the `'plugin'`
 * vs `'none'` distinction it affects is never consulted by the `local-mine` check) - still
 * moved onto the shared `useCapabilityRouting` for #148's actual ask (stop hand-copying this
 * derivation per call site so the copies can't drift, the way ClickTrackWidget.tsx's real
 * display bug happened), not because this specific hook needed the pluginId fix itself.
 *
 * Explicitly stops while the page is hidden (`document.visibilityState`), rather than leaving
 * clickEngine.ts's own resync-on-a-large-gap logic to paper over it: a backgrounded tab still
 * gets the *occasional* `setInterval` tick even under heavy throttling (never fully zero - only
 * `requestAnimationFrame` is guaranteed to stop entirely while hidden), and each of those stray
 * ticks resyncs to wherever the synced clock is *at that moment* and plays one click - audible as
 * sporadic, arrhythmic ticks rather than either clean silence or the correct rhythm (found live,
 * 2026-09-10, immediately after the resync fix). Stopping outright while hidden and restarting
 * (cleanly re-anchored, the same path pause/resume already takes) once visible again is the only
 * way to get true silence during the gap instead of occasional stray hits.
 */
export function useClickOutputDriver(): void {
  const { mode, queue, elapsedMs, playbackStatus, liveTempoAdjustPercent, clickTrackOverride } = useShowMode()
  const { engine } = useCapabilityRouting(CAPABILITIES.clickTrack, mode)
  const loopActive = useLoopTrainerStore((state) => state.active)
  const isPageVisible = useSyncExternalStore(subscribeToVisibility, isPageVisibleSnapshot, () => true)

  const song = queue.currentVariant ?? queue.currentSong
  const isMyDeviceClickOutput = engine === 'local-mine'
  const enabled = song ? effectiveClickEnabled(song.clickTrackEnabled, clickTrackOverride) : false
  const shouldPlay = isMyDeviceClickOutput && enabled && playbackStatus === 'playing' && elapsedMs !== null && isPageVisible

  // Kept fresh every render (elapsedMs ticks every animation frame while playing) rather than
  // closed over once - clickEngine.ts's scheduler polls this on every tick.
  const stateRef = useRef<ClickEngineState>({
    elapsedMs,
    bpm: 120,
    timeSignature: '4/4',
    beatAnchors: [],
    countInBars: 0,
    tempoMarkers: [],
  })
  useEffect(() => {
    stateRef.current = {
      elapsedMs,
      bpm: song ? adjustedBpm(song.bpm, liveTempoAdjustPercent) : 120,
      timeSignature: song?.timeSignature ?? '4/4',
      // beatAnchors (#25 follow-up) only exists on SongVariant, not the bare Song fallback -
      // same "no variant means no anchors" shape as `cues`. Not scaled/affected by the live
      // tempo nudge above - a nudge is a virtual grid-spacing correction, unrelated to where
      // real downbeats sit in the anchors' fixed timestamps.
      beatAnchors: queue.currentVariant?.beatAnchors ?? [],
      // countInEnabled gates countInBars - unchecked means no count-in regardless of the
      // authored bar count, same "checkbox is the real toggle" contract SheetEditor.tsx exposes.
      countInBars: queue.currentVariant?.countInEnabled ? (queue.currentVariant.countInBars ?? 0) : 0,
      // tempoMarkers (#141) - same "no variant means none" shape as beatAnchors above; also not
      // affected by the live tempo nudge (a marker's own bpm is used as authored).
      tempoMarkers: queue.currentVariant?.tempoMarkers ?? [],
      // Rehearsal Looper (#61): the click follows the trainer's current pass speed and stays inside
      // the looped section. Read at render time - elapsedMs re-renders this every animation frame.
      ...loopClickState(loopActive),
    }
  })

  useEffect(() => {
    if (!shouldPlay) {
      stopClick()
      return
    }
    startClick(() => stateRef.current)
    return () => stopClick()
  }, [shouldPlay])
}
