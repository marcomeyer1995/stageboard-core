import { useEffect, useRef, useState } from 'react'
import type { PlaybackStatus } from 'shared-types'
import { CAPABILITIES, type ShowControlEvent } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { resolveTrackForEntry } from '../lib/computeQueue'
import { loadLocalTrack, pauseLocalTrack, playLocalTrack, stopLocalTrack, unloadLocalTrack } from '../lib/localAudioEngine'
import { triggerShowControl } from '../lib/showControlClient'
import { resolveAudioEngine } from '../lib/audioEngine'
import { useShowMode } from '../lib/showMode'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'

function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * The one Play/Pause/Stop/Reset control for the current song (#13, closing docs/07's
 * long-deferred "explizite Pause/Stop-Kontrolle" idea) - works the same in Gig mode (with or
 * without an `audio-playback` plugin installed, or a device claimed as tonight's audio output
 * - see AudioOutputControl.tsx / #10's first slice) and Practice mode (see useShowMode.ts).
 *
 * Gig mode's default routes through whichever plugin `pluginProviding` resolves, same as the
 * previous ShowPlaybackWidget - degrades to a disconnected state if none is reachable, and
 * deliberately never falls back to this device's own speaker on its own (a tablet
 * unexpectedly outputting audio mid-show would be worse than silence) - that only happens if
 * someone explicitly claims it via AudioOutputControl. Practice mode always plays locally
 * (localAudioEngine.ts), since it's inherently just this device's own headphones.
 *
 * When a device *is* claimed as the audio output, that device's engine is driven reactively
 * off `playbackStatus` (a separate effect below) rather than from this widget's own onClick
 * handlers - the button that started/stopped the song and the device that must actually make
 * the sound can be two different tablets (e.g. the bandleader controls transport from their
 * own tablet while a guitarist's tablet, plugged into an amp, is the claimed audio output).
 * `ShowState` already syncs to every tablet for exactly this reason (that's how a non-master
 * tablet's Prompter stays in sync at all), so the claimed device just reacts to the same
 * stream everyone else already reads - no new relay/networking needed for this to work.
 */
export function ShowTransportWidget() {
  const { mode, queue, elapsedMs, playbackStatus, trackOverride, canControl, play, pause, stop, reset } = useShowMode()
  const { currentEntry, currentSong, currentVariant } = queue
  const claimMaster = useShowStateStore((state) => state.claimMaster)
  const clientId = useShowStateStore((state) => state.clientId)
  const audioOutputDeviceId = useShowStateStore((state) => state.state.audioOutputDeviceId)
  const installed = usePluginsStore((state) => state.installed)

  const usesDeviceOutput = mode === 'gig' && audioOutputDeviceId !== null
  const pluginId = mode === 'gig' && !usesDeviceOutput ? pluginProviding(installed, CAPABILITIES.audioPlayback) : null
  const engine = resolveAudioEngine(mode, audioOutputDeviceId, clientId, pluginId)
  const isMyDeviceAudioOutput = mode === 'gig' && engine === 'local-mine'
  const remoteDeviceOutput = engine === 'local-other'
  const usesLocalEngine = engine === 'local-mine'

  const [error, setError] = useState<string | null>(null)

  const track = resolveTrackForEntry(currentEntry, currentVariant, trackOverride)

  async function forward(event: ShowControlEvent) {
    if (!pluginId) return
    const result = await triggerShowControl(pluginId, event)
    setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
  }

  // No track attached at all (e.g. an a cappella song) is a normal, expected state, not an
  // error - shown separately from `error` below, same distinction BackingTrackPlayerWidget
  // used to draw with "Kein Track angehängt". Only relevant on whichever device is actually
  // responsible for playing something locally.
  const noLocalTrack = usesLocalEngine && (!currentVariant || !track)

  // Loads (or unloads) whichever engine this device is responsible for - fires on a genuine
  // song/variant/track change, never on a bare play/pause/stop click.
  useEffect(() => {
    if (!canControl || !currentSong) return
    if (mode === 'gig' && !usesDeviceOutput) {
      if (!pluginId) return
      void forward({
        type: 'load',
        payload: { songId: currentSong.id, variantId: currentVariant?.id ?? null, trackId: track?.id ?? null },
      })
      return
    }
    if (!usesLocalEngine) return // a different device owns the claimed audio output - not my job
    if (!currentVariant || !track) {
      // No track for this song at all - make sure the local player isn't still holding a
      // previous song's audio loaded (#13 follow-up: it silently kept playing the last-loaded
      // track otherwise, even though the UI already says "Kein Track angehängt").
      unloadLocalTrack()
      return
    }
    void loadLocalTrack(currentVariant.id, track.id).then((result) => {
      setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pluginId, usesDeviceOutput, usesLocalEngine, currentSong?.id, currentVariant?.id, track?.id, canControl])

  // Reactively mirrors the synced playbackStatus onto this device's local engine, whenever
  // this device is Gig mode's claimed audio output - see the widget doc comment above for why
  // this can't just live in the button click handlers.
  const lastAppliedStatusRef = useRef<PlaybackStatus | null>(null)
  useEffect(() => {
    if (!isMyDeviceAudioOutput) return
    if (lastAppliedStatusRef.current === playbackStatus) return
    lastAppliedStatusRef.current = playbackStatus
    if (playbackStatus === 'playing') playLocalTrack()
    else if (playbackStatus === 'paused') pauseLocalTrack()
    else stopLocalTrack()
  }, [isMyDeviceAudioOutput, playbackStatus])

  // Stops local audio the moment this device stops being the claimed output (someone released
  // it, or claimed a different device) - a stale claim must never keep making sound.
  useEffect(() => {
    if (!isMyDeviceAudioOutput) return
    return () => {
      stopLocalTrack()
      lastAppliedStatusRef.current = null
    }
  }, [isMyDeviceAudioOutput])

  if (!currentSong) {
    return <div className="flex h-full items-center justify-center text-ink-faint">Kein Song aktiv</div>
  }

  if (!canControl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-soft">
        <span className="text-center text-sm">Dieses Gerät hat aktuell keine Kontrolle über die Show</span>
        <button
          type="button"
          onClick={claimMaster}
          className="rounded-sb-sm bg-control-strong px-3 py-1 text-sm font-medium text-accent hover:bg-control-strong-hover"
        >
          Master übernehmen
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2 text-ink-soft">
      <span className="truncate text-sm">
        <span className="font-semibold text-ink">{currentSong.title}</span>
        {currentVariant && !currentVariant.isDefault && (
          <span className="ml-1 text-xs text-accent">({currentVariant.label})</span>
        )}
        <span className="ml-2 font-sb-mono text-ink">{formatClock(elapsedMs ?? 0)}</span>
      </span>
      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => {
            void play()
            if (!usesDeviceOutput) void forward({ type: 'play' })
          }}
          className={`rounded-sb py-2 text-sm font-bold uppercase tracking-wide transition-colors ${
            playbackStatus === 'playing'
              ? 'bg-accent text-accent-ink'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          Play
        </button>
        <button
          type="button"
          onClick={() => {
            void pause()
            if (!usesDeviceOutput) void forward({ type: 'pause' })
          }}
          className={`rounded-sb py-2 text-sm font-bold uppercase tracking-wide transition-colors ${
            playbackStatus === 'paused'
              ? 'bg-accent text-accent-ink'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          Pause
        </button>
        <button
          type="button"
          onClick={() => {
            void stop()
            if (!usesDeviceOutput) void forward({ type: 'stop' })
          }}
          className="rounded-sb bg-control-strong py-2 text-sm font-bold uppercase tracking-wide text-ink hover:bg-control-strong-hover"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={() => void reset()}
          className="rounded-sb bg-control-strong py-2 text-sm font-bold uppercase tracking-wide text-ink hover:bg-control-strong-hover"
        >
          Reset
        </button>
      </div>
      {remoteDeviceOutput && <p className="text-xs text-ink-faint">Audio läuft über ein anderes Gerät</p>}
      {noLocalTrack && <p className="text-xs text-ink-faint">Kein Track angehängt</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
