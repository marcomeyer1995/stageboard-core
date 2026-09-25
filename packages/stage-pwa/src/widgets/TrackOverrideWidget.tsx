import { isSongEntry } from 'shared-types'
import { resolveTrackForEntry, resolveVariantForEntry } from '../lib/computeQueue'
import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { DEFAULT_SIZE_RATIO, type TrackOverrideConfig } from './trackOverrideConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

/**
 * Swaps which track of the current variant plays - not solo-practice-only, despite living next to ShowTransportWidget's
 * Practice-mode audio: e.g. tonight's second guitarist couldn't make it, so the shared PA feed
 * needs the "1 guitar" mix instead of the setlist's usual "no guitar" one, and this is the
 * fastest way to swap it for just this show without editing the setlist itself. In Gig mode
 * that write is Master-gated and shared (ShowState.trackOverride, everyone hears the same
 * feed); in Practice mode it's a purely personal, local choice (only this device's speakers
 * are affected) - see useShowMode.ts.
 *
 * The empty option is labelled with the track that plays without an override ("Automatisch
 * (Mix komplett)"), resolved by the same `resolveTrackForEntry` playback uses - not "Standard
 * (Setlist)": no setlist UI sets `SetlistEntry.trackId`, so the default is the variant's first
 * band-mix (else its first track), not a setlist choice (Marco, 2026-09-25).
 *
 * In Practice mode it also picks the *variant* (Marco, 2026-09-25): without an active setlist
 * every catalog entry carries `variantId: null`, so this is the only way to practice a
 * non-default variant. Personal and local (usePracticeStateStore.variantOverride); Gig mode
 * doesn't offer it - the variant there is the setlist's, a band-wide choice.
 *
 * Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco, 2026-09-14).
 */
export function TrackOverrideWidget({ config }: { config: TrackOverrideConfig }) {
  const { queue, trackOverride, canControl, setTrackOverride, variantOverride, setVariantOverride } = useShowMode()
  const { currentEntry, currentSong, currentVariant } = queue
  const variants = useSongVariantsStore((state) => state.variants)
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

  // Practice mode only (setVariantOverride is null in Gig mode) and only when there is actually
  // something to choose. The default option names the variant the entry itself resolves to -
  // the setlist's pick, else the song's default variant.
  const songVariants = currentSong ? variants.filter((v) => v.songId === currentSong.id) : []
  const entryVariant = currentEntry && isSongEntry(currentEntry) ? resolveVariantForEntry(currentEntry, variants) : null
  const showVariantPicker = setVariantOverride !== null && songVariants.length > 1

  const tracks = currentVariant?.tracks ?? []
  const defaultTrack = resolveTrackForEntry(currentEntry, currentVariant, null)
  const trackMessage =
    tracks.length === 0 ? 'Kein Track angehängt' : tracks.length < 2 ? 'Nur ein Track vorhanden - kein Wechsel nötig' : null

  if (!showVariantPicker && trackMessage) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">{trackMessage}</div>
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2 text-ink-soft">
      {showVariantPicker && (
        <>
          <div className="w-full overflow-hidden">
            <span style={{ fontSize }} className="block truncate uppercase tracking-widest text-ink-faint">
              Variante
            </span>
          </div>
          <select
            aria-label="Variante"
            value={variantOverride ?? ''}
            onChange={(e) => setVariantOverride(e.target.value || null)}
            style={{ fontSize }}
            className="rounded-sb-sm bg-control px-2 py-1 text-ink"
          >
            <option value="">Automatisch ({entryVariant?.label})</option>
            {songVariants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </>
      )}
      <div className="w-full overflow-hidden">
        <span style={{ fontSize }} className="block truncate uppercase tracking-widest text-ink-faint">
          Track für „{currentVariant?.label}"
        </span>
      </div>
      {trackMessage ? (
        <span className="text-sm text-ink-faint">{trackMessage}</span>
      ) : (
        <select
          aria-label="Track"
          value={trackOverride ?? ''}
          disabled={!canControl}
          onChange={(e) => setTrackOverride(e.target.value || null)}
          style={{ fontSize }}
          className="rounded-sb-sm bg-control px-2 py-1 text-ink disabled:opacity-40"
        >
          <option value="">Automatisch ({defaultTrack?.label})</option>
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.label}
            </option>
          ))}
        </select>
      )}
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
