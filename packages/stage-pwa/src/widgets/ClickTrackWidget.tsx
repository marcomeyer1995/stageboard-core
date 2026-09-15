import { CAPABILITIES } from 'shared-types'
import { effectiveClickEnabled } from '../lib/metronome'
import { useCapabilityRouting } from '../lib/useCapabilityRouting'
import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type ClickTrackConfig } from './clickTrackConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

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
 * (found live, 2026-09-10, same bug as ShowTransportWidget's audio path). `engine` (below) is
 * safe to re-derive here too, purely for display - it's a plain derivation, not the
 * side-effecting part; `useCapabilityRouting` (#148) is the same shared derivation
 * useClickOutputDriver.ts uses for the actual routing decision, so the two can no longer drift
 * out of sync with each other the way their previous hand-copied versions did - this widget's
 * own copy hardcoded `pluginId` to `null`, so a click-track device bound through the
 * Stage-Server (rather than a specific tablet) always showed "Kein Klick-Ausgabegerät
 * eingerichtet" here even though it was correctly configured. The override control is
 * a shared, Master-gated ShowState write in Gig mode (works from *any* tablet regardless of
 * which one actually produces the sound, same as Play/Pause), a local per-device choice in
 * Practice mode (useShowMode.ts) - either way `useShowMode()` already resolves which one
 * applies, so this widget doesn't need its own mode branching.
 *
 * The "An"/"Aus" label is sized as a ratio of the device-wide default, not auto-fit to the
 * tile (Marco, 2026-09-14).
 */
export function ClickTrackWidget({ config }: { config: ClickTrackConfig }) {
  const { mode, queue, clickTrackOverride, setClickTrackOverride, canControl } = useShowMode()
  const { engine } = useCapabilityRouting(CAPABILITIES.clickTrack, mode)

  const song = queue.currentVariant ?? queue.currentSong
  const isMyDeviceClickOutput = engine === 'local-mine'
  const enabled = song ? effectiveClickEnabled(song.clickTrackEnabled, clickTrackOverride) : false
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

  if (engine === 'none') {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Kein Klick-Ausgabegerät eingerichtet
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center gap-1 text-ink-soft">
      <span className="text-xs uppercase tracking-widest text-ink-faint">
        Klick{isMyDeviceClickOutput ? ' · dieses Gerät' : ''}
      </span>
      <div className="flex w-full flex-1 items-center justify-center overflow-hidden">
        <span style={{ fontSize }} className="whitespace-nowrap font-bold">
          {enabled ? 'An' : 'Aus'}
        </span>
      </div>
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

export function ClickTrackConfigPanel({
  config,
  onChange,
}: {
  config: ClickTrackConfig
  onChange: (next: ClickTrackConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
