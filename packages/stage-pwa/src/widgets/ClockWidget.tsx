import { useNow } from '../lib/useNow'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type ClockConfig } from './clockConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

/** A prominent wall-clock readout for stage timing (#23) - unlike SyncCheckWidget's
 * server-synced flash, this is plain local time, the same clock the venue's own wall
 * clock shows.
 *
 * Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco, 2026-09-14). */
export function ClockWidget({ config }: { config: ClockConfig }) {
  const now = useNow(1000)
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden text-center">
      <span style={{ fontSize }} className="whitespace-nowrap font-bold tabular-nums text-ink">
        {new Date(now).toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
    </div>
  )
}

export function ClockConfigPanel({
  config,
  onChange,
}: {
  config: ClockConfig
  onChange: (next: ClockConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
