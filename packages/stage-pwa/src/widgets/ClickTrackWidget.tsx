import { useEffect, useRef } from 'react'
import { CAPABILITIES } from 'shared-types'
import { startClick, stopClick, type ClickEngineState } from '../lib/clickEngine'
import { supportsLocalExecution } from '../lib/clientTranslator'
import { resolveHardwareEngine } from '../lib/hardwareRouting'
import { adjustedBpm, effectiveClickEnabled } from '../lib/metronome'
import { useHardwareBindingFor } from '../lib/useHardwareBindingFor'
import { useShowMode } from '../lib/showMode'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'

const OVERRIDE_OPTIONS: Array<{ value: 'on' | 'off' | null; label: string }> = [
  { value: null, label: 'Standard' },
  { value: 'on', label: 'An' },
  { value: 'off', label: 'Aus' },
]

/**
 * Runs the Click Generator's audio (#25) on whichever tablet is bound as its execution target -
 * same `useHardwareBindingFor`/`resolveHardwareEngine` routing ShowTransportWidget already uses
 * for audio-playback, and the same "no plugin needed, a browser API does the job"
 * special-case (clientTranslator.ts's supportsLocalExecution) as that capability. Also carries
 * the force-on/off override control, which works from *any* tablet regardless of which one
 * actually produces the sound - it's a shared ShowState write (setClickTrackOverride), the same
 * way Play/Pause work from any tablet even though only the bound audio-output device makes noise.
 */
export function ClickTrackWidget() {
  const { queue, elapsedMs, playbackStatus, liveTempoAdjustPercent, clickTrackOverride, setClickTrackOverride, canControl } =
    useShowMode()
  const deviceId = useShowStateStore((state) => state.deviceId)
  const installed = usePluginsStore((state) => state.installed)
  const binding = useHardwareBindingFor(CAPABILITIES.clickTrack)

  const song = queue.currentVariant ?? queue.currentSong
  const engine = resolveHardwareEngine(binding, deviceId, null, supportsLocalExecution(installed, CAPABILITIES.clickTrack))
  const isMyDeviceClickOutput = engine === 'local-mine'
  const enabled = song ? effectiveClickEnabled(song.clickTrackEnabled, clickTrackOverride) : false
  const shouldPlay = isMyDeviceClickOutput && enabled && playbackStatus === 'playing' && elapsedMs !== null

  // Kept fresh every render (elapsedMs ticks every animation frame while playing) rather than
  // closed over once - clickEngine.ts's scheduler polls this on every tick, same reasoning as
  // TunerWidget.tsx's configRef for its own always-fresh-settings problem.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPlay])

  if (binding === null) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Kein Klick-Ausgabegerät eingerichtet
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-soft">
      <span className="text-xs uppercase tracking-widest text-ink-faint">
        Klick{isMyDeviceClickOutput ? ' · dieses Gerät' : ''}
      </span>
      <span className="text-xl font-bold">{enabled ? 'An' : 'Aus'}</span>
      <div className="flex items-center gap-1">
        {OVERRIDE_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={!canControl}
            onClick={() => setClickTrackOverride(option.value)}
            className={`rounded-sb-sm px-3 py-1 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
              clickTrackOverride === option.value
                ? 'bg-accent text-accent-ink'
                : 'bg-control-strong text-ink hover:bg-control-strong-hover'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
