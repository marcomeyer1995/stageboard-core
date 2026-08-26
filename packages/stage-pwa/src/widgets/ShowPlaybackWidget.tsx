import { useEffect, useState } from 'react'
import { CAPABILITIES, type ShowControlEvent } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { useQueue } from '../lib/queue'
import { triggerShowControl } from '../lib/showControlClient'
import { usePluginsStore } from '../store/usePluginsStore'

interface PlaybackState {
  songId: string | null
  isPlaying: boolean
  positionMs: number
}

const DEFAULT_STATE: PlaybackState = { songId: null, isPlaying: false, positionMs: 0 }

/**
 * Show-side backing-track control (docs/01 "Flexible Audio-Routing-Matrix"): sends transport
 * commands over the HTTP cue channel (showControlClient) to whichever installed plugin
 * provides `audio-playback` (mock-playback today, a real ALSA/USB-interface engine later) -
 * unlike QuickActions/LightingCues, which are still local-feedback stubs, this one is wired
 * end-to-end and reflects the state the Stage-Server actually reports back.
 */
export function ShowPlaybackWidget() {
  const { currentSong } = useQueue()
  const installed = usePluginsStore((state) => state.installed)
  const pluginId = pluginProviding(installed, CAPABILITIES.audioPlayback)
  const [state, setState] = useState<PlaybackState>(DEFAULT_STATE)
  const [error, setError] = useState<string | null>(null)

  async function send(event: ShowControlEvent) {
    if (!pluginId) return
    const result = await triggerShowControl(pluginId, event)
    if (result.status === 'error') {
      setError(result.message ?? 'Fehler')
      return
    }
    setError(null)
    const data = result.data as Partial<PlaybackState> | undefined
    if (data) setState((prev) => ({ ...prev, ...data }))
  }

  useEffect(() => {
    if (!pluginId || !currentSong) return
    void send({ type: 'load', payload: { songId: currentSong.id } })
    // Re-fires only on a genuine song change, not on every re-render of the queue/store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, currentSong?.id])

  if (!pluginId) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        Kein Playback-Plugin installiert
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2 text-ink-soft">
      <span className="truncate text-sm">
        {currentSong ? (
          <>
            Track: <span className="font-semibold text-ink">{currentSong.title}</span>
          </>
        ) : (
          'Kein Song aktiv'
        )}
      </span>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => void send({ type: 'play' })}
          className={`rounded-sb py-2 text-sm font-bold uppercase tracking-wide transition-colors ${
            state.isPlaying
              ? 'bg-accent text-accent-ink'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          Play
        </button>
        <button
          type="button"
          onClick={() => void send({ type: 'pause' })}
          className="rounded-sb bg-control-strong py-2 text-sm font-bold uppercase tracking-wide text-ink hover:bg-control-strong-hover"
        >
          Pause
        </button>
        <button
          type="button"
          onClick={() => void send({ type: 'stop' })}
          className="rounded-sb bg-control-strong py-2 text-sm font-bold uppercase tracking-wide text-ink hover:bg-control-strong-hover"
        >
          Stop
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
