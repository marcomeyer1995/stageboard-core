import { isSongEntry } from 'shared-types'
import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type ActiveSetlistConfig } from './activeSetlistConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

/** A glanceable "which setlist is live right now" readout, for a dashboard that doesn't
 * already show it via Live-Queue/Next-Song - the same question Marco wanted answered in
 * the Bibliothek (LibraryView.tsx/SetlistDetail.tsx's "● Aktiv" badges) and the main menu
 * (MasterControl.tsx).
 *
 * Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco, 2026-09-14). */
export function ActiveSetlistWidget({ config }: { config: ActiveSetlistConfig }) {
  // Mode-aware (#247): Gig = shared ShowState setlist, Solo Üben = the practice setlist.
  const {
    queue: { activeSetlist },
  } = useShowMode()
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

  return (
    <div className="flex h-full flex-col items-center gap-1 text-center">
      <span className="text-xs font-bold uppercase tracking-widest text-ink-faint">
        Aktive Setlist
      </span>
      <div className="flex w-full flex-1 items-center justify-center overflow-hidden">
        <span
          style={{ fontSize }}
          className={`whitespace-nowrap font-semibold ${activeSetlist ? 'text-ink' : 'text-ink-faint'}`}
        >
          {activeSetlist ? activeSetlist.name : 'Keine'}
        </span>
      </div>
      {activeSetlist && <span className="text-sm text-ink-muted">{activeSetlist.entries.filter(isSongEntry).length} Songs</span>}
    </div>
  )
}

export function ActiveSetlistConfigPanel({
  config,
  onChange,
}: {
  config: ActiveSetlistConfig
  onChange: (next: ActiveSetlistConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
