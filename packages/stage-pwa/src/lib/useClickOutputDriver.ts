import { jumpBoundaryMs, rateOf } from './playbackTransport'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { CAPABILITIES } from 'shared-types'
import { startClick, stopClick, type ClickEngineState } from './clickEngine'
import { startEngineClick, stopEngineClick, wasmClickWanted } from './engine/engineClick'
import { holdAudioOutputAwake } from './sharedAudioContext'
import { adjustedBpm, effectiveClickEnabled } from './metronome'
import { useCapabilityRouting } from './useCapabilityRouting'
import { useShowModeCore } from './showMode'
import { clickTimeline } from './beatGrid'
import { useAudioOutputLatencyMs } from './latencyCompensation'
import { playbackLookup } from './playbackCues'

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
  // Not useShowMode(): the engine reads the song time itself on each of its ticks, so this hook
  // re-renders on song and state changes only, not every frame (#457).
  const { mode, queue, elapsedNow, playbackStatus, liveTempoAdjustPercent, clickTrackOverride, transport } = useShowModeCore()
  const { engine } = useCapabilityRouting(CAPABILITIES.clickTrack, mode)
  const isPageVisible = useSyncExternalStore(subscribeToVisibility, isPageVisibleSnapshot, () => true)
  // Heard that much later than scheduled on this device's current output (#491).
  const outputLatencyMs = useAudioOutputLatencyMs()

  const song = queue.currentArrangement
  const isMyDeviceClickOutput = engine === 'local-mine'
  const enabled = song ? effectiveClickEnabled(song.clickTrackEnabled, clickTrackOverride) : false
  const shouldPlay = isMyDeviceClickOutput && enabled && playbackStatus === 'playing' && elapsedNow() !== null && isPageVisible

  // Kept fresh every render rather than closed over once - clickEngine.ts's scheduler polls this on
  // every tick; the song time and the loop state are read at that moment.
  const bpm = song ? adjustedBpm(song.bpm, liveTempoAdjustPercent) : 120
  const timeSignature = song?.timeSignature ?? '4/4'
  // countInEnabled gates countInBars - unchecked means no count-in regardless of the authored bar
  // count, same "checkbox is the real toggle" contract SheetEditor.tsx exposes.
  const countInBars = queue.currentVariant?.countInEnabled ? (queue.currentVariant.countInBars ?? 0) : 0
  const beatGrid = queue.currentVariant?.beatGrid
  // The live tempo nudge (#140) only changes a grid without fixed tempo (a single point, or none)
  // - on a grid aligned at several bars the track dictates the tempo.
  const timeline = useMemo(() => clickTimeline({ beatGrid, bpm, timeSignature, countInBars }), [beatGrid, bpm, timeSignature, countInBars])
  // "Klick aus" cues (#485): silent stretches, the grid keeps running.
  const cues = queue.currentVariant?.cues
  const clickOnAt = useMemo(() => {
    const at = playbackLookup(cues ?? [])
    return (ms: number) => at(ms).click
  }, [cues])
  // A queued section jump (#479) - the show's, or in Solo Üben this device's own: the click
  // schedules across it.
  const playbackJump = transport?.jump ?? null
  const startedAt = transport?.startedAt ?? null
  const accumulatedMs = transport?.accumulatedMs ?? 0
  // The loop trainer's speed (#683) - always 1 in the Gig. The click is generated at it, never stretched.
  const playbackRate = transport ? rateOf(transport) : 1
  const jump = useMemo(() => {
    if (!playbackJump) return null
    const boundaryMs = jumpBoundaryMs({ status: 'playing', startedAt, accumulatedMs, jump: playbackJump, rate: playbackRate })
    return boundaryMs === null ? null : { id: playbackJump.at, boundaryMs, toMs: playbackJump.toMs, ...(playbackJump.rate !== undefined ? { rate: playbackJump.rate } : {}) }
  }, [playbackJump, startedAt, accumulatedMs, playbackRate])
  const elapsedNowRef = useRef(elapsedNow)
  elapsedNowRef.current = elapsedNow
  const stateRef = useRef<ClickEngineState>({ elapsedMs: null, timeline })
  useEffect(() => {
    stateRef.current = {
      get elapsedMs() {
        return elapsedNowRef.current()
      },
      timeline,
      playbackRate,
      outputLatencyMs,
      clickOnAt,
      jump,
      ...(transport ? { transport } : {}),
    }
  })

  // The click's output stays awake between songs, or a Bluetooth/wireless output would swallow the
  // first clicks while waking up (sharedAudioContext.ts, #468).
  const holdsOutput = isMyDeviceClickOutput && enabled
  useEffect(() => {
    holdAudioOutputAwake('click', holdsOutput)
    return () => holdAudioOutputAwake('click', false)
  }, [holdsOutput])

  // The engine core in the AudioWorklet instead (docs/30 §8h stage 2) - `sb:debug:wasm-click`, read
  // at each start so it can be switched without a reload.
  useEffect(() => {
    if (!shouldPlay) {
      stopClick()
      stopEngineClick()
      return
    }
    const wasm = wasmClickWanted()
    if (wasm) startEngineClick(() => stateRef.current)
    else startClick(() => stateRef.current)
    return () => (wasm ? stopEngineClick() : stopClick())
  }, [shouldPlay])
}
