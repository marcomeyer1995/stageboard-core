import { useEffect, useState } from 'react'
import { CAPABILITIES, type ShowControlEvent } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { pauseSong, playSong, resetSong, stopSong, useQueue } from '../lib/queue'
import { triggerShowControl } from '../lib/showControlClient'
import { usePlaybackElapsedMs } from '../lib/usePlaybackElapsedMs'
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
 * long-deferred "explizite Pause/Stop-Kontrolle" idea) - works identically whether or not a
 * band has an `audio-playback` plugin installed, replacing the previous split between
 * ClockControlWidget (a bare stopwatch, no ShowState/ShowLog tie-in at all) and
 * ShowPlaybackWidget (plugin-only - did nothing for a band without one).
 *
 * Drives ShowState.playbackStatus directly, so every tablet's ShowLog tracking (queue.ts) and
 * PrompterWidget (usePlaybackElapsedMs.ts) agree on it, and additionally forwards the same
 * transitions to whichever plugin provides real backing-track audio, if one is installed.
 */
export function ShowTransportWidget() {
  const { currentSong, currentVariant, isMaster } = useQueue()
  const playbackStatus = useShowStateStore((state) => state.state.playbackStatus)
  const claimMaster = useShowStateStore((state) => state.claimMaster)
  const installed = usePluginsStore((state) => state.installed)
  const pluginId = pluginProviding(installed, CAPABILITIES.audioPlayback)
  const elapsedMs = usePlaybackElapsedMs() ?? 0
  const [error, setError] = useState<string | null>(null)

  async function forward(event: ShowControlEvent) {
    if (!pluginId) return
    const result = await triggerShowControl(pluginId, event)
    setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
  }

  useEffect(() => {
    if (!pluginId || !currentSong || !isMaster) return
    void forward({ type: 'load', payload: { songId: currentSong.id, variantId: currentVariant?.id ?? null } })
    // Re-fires on a genuine song or variant change, not on every re-render of the queue/store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, currentSong?.id, currentVariant?.id, isMaster])

  if (!currentSong) {
    return <div className="flex h-full items-center justify-center text-ink-faint">Kein Song aktiv</div>
  }

  if (!isMaster) {
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
        <span className="ml-2 font-sb-mono text-ink">{formatClock(elapsedMs)}</span>
      </span>
      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => {
            void playSong()
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
            void pauseSong()
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
            void stopSong()
            void forward({ type: 'stop' })
          }}
          className="rounded-sb bg-control-strong py-2 text-sm font-bold uppercase tracking-wide text-ink hover:bg-control-strong-hover"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={() => void resetSong()}
          className="rounded-sb bg-control-strong py-2 text-sm font-bold uppercase tracking-wide text-ink hover:bg-control-strong-hover"
        >
          Reset
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
