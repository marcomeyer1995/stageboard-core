import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type TrackOverrideConfig } from './trackOverrideConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

/**
 * Swaps which track of the current variant plays, on top of the setlist's own lasting default
 * (SetlistEntry.trackId) - not solo-practice-only, despite living next to ShowTransportWidget's
 * Practice-mode audio: e.g. tonight's second guitarist couldn't make it, so the shared PA feed
 * needs the "1 guitar" mix instead of the setlist's usual "no guitar" one, and this is the
 * fastest way to swap it for just this show without editing the setlist itself. In Gig mode
 * that write is Master-gated and shared (ShowState.trackOverride, everyone hears the same
 * feed); in Practice mode it's a purely personal, local choice (only this device's speakers
 * are affected) - see useShowMode.ts.
 *
 * Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco, 2026-09-14).
 */
export function TrackOverrideWidget({ config }: { config: TrackOverrideConfig }) {
  const { queue, trackOverride, canControl, setTrackOverride } = useShowMode()
  const { currentVariant } = queue
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

  if (!currentVariant || currentVariant.tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Kein Track angehängt
      </div>
    )
  }

  if (currentVariant.tracks.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Nur ein Track vorhanden - kein Wechsel nötig
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2 text-ink-soft">
      <div className="w-full overflow-hidden">
        <span style={{ fontSize }} className="block truncate uppercase tracking-widest text-ink-faint">
          Track für „{currentVariant.label}"
        </span>
      </div>
      <select
        value={trackOverride ?? ''}
        disabled={!canControl}
        onChange={(e) => setTrackOverride(e.target.value || null)}
        style={{ fontSize }}
        className="rounded-sb-sm bg-control px-2 py-1 text-ink disabled:opacity-40"
      >
        <option value="">Standard (Setlist)</option>
        {currentVariant.tracks.map((track) => (
          <option key={track.id} value={track.id}>
            {track.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function TrackOverrideConfigPanel({
  config,
  onChange,
}: {
  config: TrackOverrideConfig
  onChange: (next: TrackOverrideConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
