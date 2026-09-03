import { useEffect, useState } from 'react'
import { CAPABILITIES, type ShowControlEvent } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { resolveTrackForEntry } from '../lib/computeQueue'
import { loadLocalTrack, unloadLocalTrack } from '../lib/localAudioEngine'
import { triggerShowControl } from '../lib/showControlClient'
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
 * without an `audio-playback` plugin installed) and Practice mode (see useShowMode.ts).
 *
 * Gig mode routes through whichever plugin `pluginProviding` resolves, same as the previous
 * ShowPlaybackWidget - degrades to a disconnected state if none is reachable, and deliberately
 * never falls back to this device's own speaker (a tablet unexpectedly outputting audio mid-
 * show would be worse than silence). Practice mode always plays locally
 * (localAudioEngine.ts), since it's inherently just this device's own headphones - built as a
 * standalone module rather than private to this widget, so a future #10 ("Logical Devices &
 * Hardware Setup Profiles") HAL binding that assigns *this specific tablet* as a Gig-mode
 * show's live audio-output target can reuse it directly instead of duplicating it.
 */
export function ShowTransportWidget() {
  const { mode, queue, elapsedMs, playbackStatus, trackOverride, canControl, play, pause, stop, reset } = useShowMode()
  const { currentEntry, currentSong, currentVariant } = queue
  const claimMaster = useShowStateStore((state) => state.claimMaster)
  const installed = usePluginsStore((state) => state.installed)
  const pluginId = mode === 'gig' ? pluginProviding(installed, CAPABILITIES.audioPlayback) : null
  const [error, setError] = useState<string | null>(null)

  const track = resolveTrackForEntry(currentEntry, currentVariant, trackOverride)

  async function forward(event: ShowControlEvent) {
    if (!pluginId) return
    const result = await triggerShowControl(pluginId, event)
    setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
  }

  // Practice mode with no track attached at all (e.g. an a cappella song) is a normal, expected
  // state, not an error - shown separately from `error` below, same distinction
  // BackingTrackPlayerWidget used to draw with "Kein Track angehängt".
  const noLocalTrack = mode === 'practice' && (!currentVariant || !track)

  useEffect(() => {
    if (!canControl || !currentSong) return
    if (mode === 'gig') {
      if (!pluginId) return
      void forward({
        type: 'load',
        payload: { songId: currentSong.id, variantId: currentVariant?.id ?? null, trackId: track?.id ?? null },
      })
      return
    }
    if (!currentVariant || !track) {
      // No track for this song at all - make sure the shared local player isn't still
      // holding a previous song's audio loaded (#13 follow-up: it silently kept playing the
      // last-loaded track otherwise, even though the UI already says "Kein Track angehängt").
      unloadLocalTrack()
      return
    }
    void loadLocalTrack(currentVariant.id, track.id).then((result) => {
      setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
    })
    // Re-fires on a genuine song/variant/track change, not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pluginId, currentSong?.id, currentVariant?.id, track?.id, canControl])

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
            void forward({ type: 'play' })
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
            void forward({ type: 'pause' })
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
            void forward({ type: 'stop' })
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
      {noLocalTrack && <p className="text-xs text-ink-faint">Kein Track angehängt</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
