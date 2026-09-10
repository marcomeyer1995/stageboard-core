import { useEffect, useRef } from 'react'
import type { PlaybackStatus } from 'shared-types'
import { CAPABILITIES, SERVER_EXECUTION_TARGET } from 'shared-types'
import { pluginProviding } from './capabilities'
import { supportsLocalExecution } from './clientTranslator'
import { resolveTrackForEntry } from './computeQueue'
import { resolveExecutionEngine } from './hardwareRouting'
import {
  loadLocalTrack,
  pauseLocalTrack,
  playLocalTrack,
  stopLocalTrack,
  syncLocalTrackPosition,
  unloadLocalTrack,
} from './localAudioEngine'
import { triggerShowControl } from './showControlClient'
import { useHardwareBindingFor } from './useHardwareBindingFor'
import { useShowMode } from './showMode'
import { useLocalAudioOutputStore } from '../store/useLocalAudioOutputStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'

/**
 * Drives Gig-mode audio-playback (#13) regardless of which top-level tab (Live/Bibliothek/
 * System, modes.ts) is currently showing - mounted once, unconditionally, in App.tsx.
 *
 * This used to live entirely inside ShowTransportWidget.tsx's own effects, which meant switching
 * away from the Live tab unmounted the widget and, via its "stop when no longer the claimed
 * output" effect's own cleanup, silently stopped a live show's backing track mid-song (found
 * live, 2026-09-10 - "that would be a disaster" is exactly right). The same reasoning applies to
 * the "forward a load event to whichever plugin provides audio-playback" effect: only the Master
 * is supposed to send that, and the Master's own tablet must keep sending it on every song change
 * no matter which tab that tablet's user happens to be looking at.
 *
 * ShowTransportWidget.tsx still owns the actual Play/Pause/Stop/Reset UI and its click handlers
 * (a click can only happen while mounted, so that part is fine staying widget-local) and
 * re-derives the same read-only routing booleans (`engine`/`usesDeviceOutput`/`pluginId`) purely
 * for display - safe to duplicate since those are plain derivations, not side effects. Only the
 * actual playLocalTrack/loadLocalTrack/triggerShowControl calls live here, exactly once.
 */
export function useAudioOutputDriver(): void {
  const { mode, queue, elapsedMs, playbackStatus, trackOverride, canControl } = useShowMode()
  const { currentEntry, currentSong, currentVariant } = queue

  // Kept fresh every render without being a dependency of the load/play effects below (same
  // reasoning as useClickOutputDriver.ts's stateRef) - those must fire only on a genuine
  // song/track change or play/pause/stop transition, never merely because elapsedMs ticked.
  const elapsedMsRef = useRef<number | null>(elapsedMs)
  useEffect(() => {
    elapsedMsRef.current = elapsedMs
  })
  const deviceId = useShowStateStore((state) => state.deviceId)
  const audioBinding = useHardwareBindingFor(CAPABILITIES.audioPlayback)
  const installed = usePluginsStore((state) => state.installed)

  const usesDeviceOutput =
    mode === 'gig' && audioBinding !== null && audioBinding.executionTarget !== SERVER_EXECUTION_TARGET
  const pluginId = mode === 'gig' && !usesDeviceOutput ? pluginProviding(installed, CAPABILITIES.audioPlayback) : null
  const engine = resolveExecutionEngine(
    mode,
    audioBinding,
    deviceId,
    pluginId,
    supportsLocalExecution(installed, CAPABILITIES.audioPlayback),
  )
  const isMyDeviceAudioOutput = mode === 'gig' && engine === 'local-mine'
  const usesLocalEngine = engine === 'local-mine'

  const track = resolveTrackForEntry(currentEntry, currentVariant, trackOverride)

  // Forwards a "load" event to whichever plugin provides audio-playback, on a genuine
  // song/variant/track change - only the Master should ever trigger this network call, since
  // every device would otherwise race to send the same event.
  useEffect(() => {
    if (!canControl || !currentSong) return
    if (mode !== 'gig' || usesDeviceOutput || !pluginId) return
    void triggerShowControl(pluginId, {
      type: 'load',
      payload: { songId: currentSong.id, variantId: currentVariant?.id ?? null, trackId: track?.id ?? null },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pluginId, usesDeviceOutput, currentSong?.id, currentVariant?.id, track?.id, canControl])

  // Loads (or unloads) this device's own local engine, whenever it's the claimed audio output -
  // deliberately excludes `canControl`/`mode`/`pluginId`/`usesDeviceOutput` from its own
  // dependencies: the whole point of a device claim is that the claimed device can be a
  // *different* tablet than whoever holds Master, so a bare Master handoff must never re-run
  // this at all, only a genuine change to the synced song/track itself. Cues to the *current*
  // synced position, not always 0 - a device that becomes the claimed output mid-song (a
  // hardware rebind, a late join) must start from the right place (found live, 2026-09-10).
  useEffect(() => {
    if (!currentSong || !usesLocalEngine) return
    if (!currentVariant || !track) {
      // No track for this song at all - make sure the local player isn't still holding a
      // previous song's audio loaded.
      unloadLocalTrack()
      useLocalAudioOutputStore.setState({ error: null })
      return
    }
    void loadLocalTrack(currentVariant.id, track.id, elapsedMsRef.current ?? 0).then((result) => {
      useLocalAudioOutputStore.setState({ error: result.status === 'error' ? (result.message ?? 'Fehler') : null })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usesLocalEngine, currentSong?.id, currentVariant?.id, track?.id])

  // Reactively mirrors the synced playbackStatus onto this device's local engine, whenever this
  // device is Gig mode's claimed audio output. Seeks to the current synced position before
  // playing - without this, resuming just continued from wherever the element happened to be
  // cued rather than the actual synced position (found live, 2026-09-10).
  const lastAppliedStatusRef = useRef<PlaybackStatus | null>(null)
  useEffect(() => {
    if (!isMyDeviceAudioOutput) return
    if (lastAppliedStatusRef.current === playbackStatus) return
    lastAppliedStatusRef.current = playbackStatus
    if (playbackStatus === 'playing') playLocalTrack(elapsedMsRef.current ?? 0)
    else if (playbackStatus === 'paused') pauseLocalTrack()
    else stopLocalTrack()
  }, [isMyDeviceAudioOutput, playbackStatus])

  // Continuously re-locks the local engine to the synced master clock while playing - the
  // backing-track equivalent of clickEngine.ts's scheduler re-anchoring to elapsedMs every tick.
  // A native <audio> element isn't guaranteed sample-accurate/clock-locked, and nothing else
  // ever re-checks it once started, so the backing track and the click (or another tablet's own
  // copy of the same file) had no ongoing synchronization with each other at all (found live,
  // 2026-09-10). `elapsedMs` itself (not the ref) is the dependency here - unlike the load/play
  // effects above, this one is *meant* to re-run on every tick while playing.
  useEffect(() => {
    if (!isMyDeviceAudioOutput || playbackStatus !== 'playing' || elapsedMs === null) return
    syncLocalTrackPosition(elapsedMs)
  }, [isMyDeviceAudioOutput, playbackStatus, elapsedMs])

  // Stops local audio the moment this device stops being the claimed output (someone released
  // it, or claimed a different device) - a stale claim must never keep making sound.
  useEffect(() => {
    if (!isMyDeviceAudioOutput) return
    return () => {
      stopLocalTrack()
      lastAppliedStatusRef.current = null
    }
  }, [isMyDeviceAudioOutput])
}
