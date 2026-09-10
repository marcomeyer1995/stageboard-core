import { useEffect, useRef, useSyncExternalStore } from 'react'
import { CAPABILITIES } from 'shared-types'
import { startClick, stopClick, type ClickEngineState } from './clickEngine'
import { supportsLocalExecution } from './clientTranslator'
import { resolveExecutionEngine } from './hardwareRouting'
import { adjustedBpm, effectiveClickEnabled } from './metronome'
import { useHardwareBindingFor } from './useHardwareBindingFor'
import { useShowMode } from './showMode'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'

function subscribeToVisibility(callback: () => void): () => void {
  document.addEventListener('visibilitychange', callback)
  return () => document.removeEventListener('visibilitychange', callback)
}

function isPageVisibleSnapshot(): boolean {
  return document.visibilityState !== 'hidden'
}

/**
 * Drives the Click Generator's Web Audio scheduler (#25, clickEngine.ts) regardless of which
 * top-level tab (Live/Bibliothek/System, modes.ts) is currently showing - mounted once,
 * unconditionally, in App.tsx. Same reasoning and same bug as useAudioOutputDriver.ts: this used
 * to live inside ClickTrackWidget.tsx's own effect, so switching away from the Live tab unmounted
 * the widget and, via the effect's cleanup, silently stopped the click mid-show. ClickTrackWidget
 * still owns the status/override UI and re-derives the same read-only booleans purely for
 * display - only the actual startClick/stopClick calls live here, exactly once.
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
  const deviceId = useShowStateStore((state) => state.deviceId)
  const installed = usePluginsStore((state) => state.installed)
  const binding = useHardwareBindingFor(CAPABILITIES.clickTrack)
  const isPageVisible = useSyncExternalStore(subscribeToVisibility, isPageVisibleSnapshot, () => true)

  const song = queue.currentVariant ?? queue.currentSong
  const engine = resolveExecutionEngine(
    mode,
    binding,
    deviceId,
    null,
    supportsLocalExecution(installed, CAPABILITIES.clickTrack),
  )
  const isMyDeviceClickOutput = engine === 'local-mine'
  const enabled = song ? effectiveClickEnabled(song.clickTrackEnabled, clickTrackOverride) : false
  const shouldPlay = isMyDeviceClickOutput && enabled && playbackStatus === 'playing' && elapsedMs !== null && isPageVisible

  // Kept fresh every render (elapsedMs ticks every animation frame while playing) rather than
  // closed over once - clickEngine.ts's scheduler polls this on every tick.
  const stateRef = useRef<ClickEngineState>({ elapsedMs, bpm: 120, timeSignature: '4/4' })
  useEffect(() => {
    stateRef.current = {
      elapsedMs,
      bpm: song ? adjustedBpm(song.bpm, liveTempoAdjustPercent) : 120,
      timeSignature: song?.timeSignature ?? '4/4',
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
