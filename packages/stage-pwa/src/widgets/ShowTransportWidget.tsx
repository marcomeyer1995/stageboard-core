import { useState } from 'react'
import { CAPABILITIES, SERVER_EXECUTION_TARGET, type ShowControlEvent } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { supportsLocalExecution } from '../lib/clientTranslator'
import { resolveTrackForEntry } from '../lib/computeQueue'
import { triggerShowControl } from '../lib/showControlClient'
import { resolveExecutionEngine } from '../lib/hardwareRouting'
import { useHardwareBindingFor } from '../lib/useHardwareBindingFor'
import { useShowMode } from '../lib/showMode'
import { useLocalAudioOutputStore } from '../store/useLocalAudioOutputStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'

/** A negative `ms` (#25 follow-up: counting in before the backing track's own audio starts,
 * elapsedMs 0) is a real, intended state - shown as a visible negative countdown up through
 * "00:00", not hidden or clamped away. `Math.floor`/`%` both propagate a negative dividend's
 * sign on their own (`-1500 -> -2` seconds, not `-1`), so the sign is pulled out and applied
 * once to the absolute value instead of trusting that arithmetic directly. */
function formatClock(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const totalSeconds = Math.floor(Math.abs(ms) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * The one Play/Pause/Stop/Reset control for the current song (#13, closing docs/07's
 * long-deferred "explizite Pause/Stop-Kontrolle" idea) - works the same in Gig mode (with or
 * without an `audio-playback` plugin installed, or an `audio-playback` binding in the active
 * HardwareSetup - see HardwareSetupPicker.tsx / #10) and Practice mode (see useShowMode.ts).
 *
 * Gig mode's default routes through whichever plugin `pluginProviding` resolves, same as the
 * previous ShowPlaybackWidget - degrades to a disconnected state if none is reachable, and
 * deliberately never falls back to this device's own speaker on its own (a tablet
 * unexpectedly outputting audio mid-show would be worse than silence) - that only happens if
 * the active HardwareSetup explicitly binds `audio-playback` to a tablet. Practice mode always
 * plays locally (localAudioEngine.ts), since it's inherently just this device's own headphones.
 *
 * This widget owns only the Play/Pause/Stop/Reset UI and its click handlers - actually driving
 * the audio engine (reactively mirroring `playbackStatus`, loading/unloading tracks, forwarding
 * "load" events to a plugin) lives in useAudioOutputDriver.ts instead, mounted once in App.tsx
 * regardless of which top-level tab is showing. It used to live here, which meant switching away
 * from the Live tab (Bibliothek/System) unmounted this widget and silently stopped a live show's
 * backing track mid-song (found live, 2026-09-10). The routing booleans below
 * (`engine`/`usesDeviceOutput`/`pluginId`) are safe to re-derive here too, purely for display -
 * they're plain derivations, not the side-effecting part.
 */
export function ShowTransportWidget() {
  const { mode, queue, elapsedMs, playbackStatus, trackOverride, canControl, play, pause, stop, reset } = useShowMode()
  const { currentSong, currentVariant } = queue
  const claimMaster = useShowStateStore((state) => state.claimMaster)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const audioBinding = useHardwareBindingFor(CAPABILITIES.audioPlayback)
  const installed = usePluginsStore((state) => state.installed)
  const driverError = useLocalAudioOutputStore((state) => state.error)

  const usesDeviceOutput =
    mode === 'gig' && audioBinding !== null && audioBinding.executionTarget !== SERVER_EXECUTION_TARGET
  const pluginId = mode === 'gig' && !usesDeviceOutput ? pluginProviding(installed, CAPABILITIES.audioPlayback) : null
  // resolveExecutionEngine's Practice branch plays locally regardless of any Gig-mode binding -
  // supportsLocalExecution is unconditionally true for audio-playback (native <audio>, no
  // plugin needed - #98), so Practice mode always resolves to 'local-mine' here.
  const engine = resolveExecutionEngine(
    mode,
    audioBinding,
    deviceId,
    pluginId,
    supportsLocalExecution(installed, CAPABILITIES.audioPlayback),
  )
  const remoteDeviceOutput = engine === 'local-other'
  const usesLocalEngine = engine === 'local-mine'

  const [error, setError] = useState<string | null>(null)

  async function forward(event: ShowControlEvent) {
    if (!pluginId) return
    const result = await triggerShowControl(pluginId, event)
    setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
  }

  // No track attached at all (e.g. an a cappella song) is a normal, expected state, not an
  // error - shown separately from `error` below, same distinction BackingTrackPlayerWidget
  // used to draw with "Kein Track angehängt". Only relevant on whichever device is actually
  // responsible for playing something locally.
  const track = resolveTrackForEntry(queue.currentEntry, currentVariant, trackOverride)
  const noLocalTrack = usesLocalEngine && (!currentVariant || !track)

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
      {(error ?? driverError) && <p className="text-xs text-red-500">{error ?? driverError}</p>}
    </div>
  )
}
