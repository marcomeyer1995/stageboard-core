import { CAPABILITIES } from 'shared-types'
import { supportsLocalExecution } from '../lib/clientTranslator'
import { resolveExecutionEngine } from '../lib/hardwareRouting'
import { effectiveClickEnabled } from '../lib/metronome'
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
 * Shows the Click Generator's (#25) status and force-on/off override control - the actual Web
 * Audio scheduler runs in useClickOutputDriver.ts instead, mounted once in App.tsx regardless
 * of which top-level tab is showing. It used to run here, which meant switching away from the
 * Live tab (Bibliothek/System) unmounted this widget and silently stopped the click mid-show
 * (found live, 2026-09-10, same bug as ShowTransportWidget's audio path). The routing booleans
 * below are safe to re-derive here too, purely for display - they're plain derivations, not the
 * side-effecting part. The override control is a shared, Master-gated ShowState write in Gig
 * mode (works from *any* tablet regardless of which one actually produces the sound, same as
 * Play/Pause), a local per-device choice in Practice mode (useShowMode.ts) - either way
 * `useShowMode()` already resolves which one applies, so this widget doesn't need its own mode
 * branching.
 */
export function ClickTrackWidget() {
  const { mode, queue, clickTrackOverride, setClickTrackOverride, canControl } = useShowMode()
  const deviceId = useShowStateStore((state) => state.deviceId)
  const installed = usePluginsStore((state) => state.installed)
  const binding = useHardwareBindingFor(CAPABILITIES.clickTrack)

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

  if (engine === 'none') {
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
