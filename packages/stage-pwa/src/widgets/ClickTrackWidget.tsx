import { CAPABILITIES } from 'shared-types'
import { effectiveClickEnabled } from '../lib/metronome'
import { useCapabilityRouting } from '../lib/useCapabilityRouting'
import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type ClickTrackConfig } from './clickTrackConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { stageFontSize } from '../lib/stageSize'
import { clickLayout, READOUT_MIN } from '../lib/gigWidgetLayout'
import { useElementSize } from '../lib/useElementSize'

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
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  // Before any early return - hooks must run in the same order on every render.
  const [boxRef, box] = useElementSize()

  if (engine === 'none') {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Kein Klick-Ausgabegerät eingerichtet
      </div>
    )
  }

  const stateFontSize = Math.max(READOUT_MIN, fontSize)
  const layout = clickLayout(box.width, box.height, stateFontSize)

  return (
    <div
      ref={boxRef}
      className={`flex h-full gap-2 text-ink-soft ${layout.row ? 'items-stretch' : 'flex-col items-center'}`}
    >
      {layout.showLabel && (
        <span className="flex-none text-xs uppercase tracking-widest text-ink-faint">
          Klick{isMyDeviceClickOutput ? ' · dieses Gerät' : ''}
        </span>
      )}
      {layout.showState && (
        <div className={`flex items-center justify-center overflow-hidden ${layout.row ? 'flex-none px-2' : 'w-full flex-1'}`}>
          {/* The click state is the readout here - never below 24px, in every layout. */}
          <span style={{ fontSize: stateFontSize }} className="whitespace-nowrap font-bold leading-none">
            {enabled ? 'An' : 'Aus'}
          </span>
        </div>
      )}
      {/* Pick one (docs/15 D7): one joined bar, the chosen segment filled. */}
      <div role="radiogroup" aria-label="Klick" className={`grid grid-cols-3 gap-0 rounded-control border border-line bg-control p-1 ${layout.row ? 'min-w-0 flex-1' : layout.showState ? 'w-full flex-none' : 'w-full min-h-0 flex-1 grid-rows-[minmax(0,1fr)]'}`}>
        {OVERRIDE_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={clickTrackOverride === option.value}
            disabled={!canControl}
            onClick={() => setClickTrackOverride(option.value)}
            className={`h-full ${layout.showState ? 'min-h-touch' : 'min-h-0'} rounded-control px-1 font-bold disabled:cursor-not-allowed disabled:opacity-40 ${
              clickTrackOverride === option.value
                ? 'bg-accent text-accent-ink'
                : 'text-ink-soft [@media(hover:hover)]:hover:bg-control-hover'
            }`}
          >
            {layout.shortLabels && option.label === 'Standard' ? 'Std.' : option.label}
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
