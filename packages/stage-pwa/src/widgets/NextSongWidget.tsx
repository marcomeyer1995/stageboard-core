import { isTransitionEntry } from 'shared-types'
import { useShowMode } from '../lib/showMode'
import { useShowStateStore } from '../store/useShowStateStore'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type NextSongConfig } from './nextSongConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

/** Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco, 2026-09-14). */
export function NextSongWidget({ config }: { config: NextSongConfig }) {
  const { queue, canControl, next, previous } = useShowMode()
  const { previousEntry, currentEntry, nextEntry, currentSong, nextSong, currentVariant, nextVariant } = queue
  const currentTransition = currentEntry && isTransitionEntry(currentEntry) ? currentEntry : null
  const nextTransition = nextEntry && isTransitionEntry(nextEntry) ? nextEntry : null
  const claimMaster = useShowStateStore((state) => state.claimMaster)
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

  return (
    <div className="flex h-full items-center justify-between gap-2 text-ink-soft">
      <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
        <span style={{ fontSize }} className="whitespace-nowrap">
          {currentTransition ? (
            <>
              Ansage: <span className="font-semibold text-ink">{currentTransition.title}</span>
            </>
          ) : currentSong ? (
            <>
              Aktuell: <span className="font-semibold text-ink">{currentSong.title}</span>
              {currentVariant && !currentVariant.isDefault && (
                <span className="ml-1 text-[0.6em] text-accent">({currentVariant.label})</span>
              )}
            </>
          ) : (
            'Keine Songs vorhanden'
          )}
          {nextTransition && (
            <>
              {' | '}
              Next: <span className="font-semibold text-ink">{nextTransition.title}</span> (Ansage)
            </>
          )}
          {nextSong && (
            <>
              {' | '}
              Next: <span className="font-semibold text-ink">{nextSong.title}</span>{' '}
              ({(nextVariant ?? nextSong).bpm} BPM)
              {nextVariant && !nextVariant.isDefault && (
                <span className="ml-1 text-[0.6em] text-accent">({nextVariant.label})</span>
              )}
            </>
          )}
        </span>
      </div>
      {canControl ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={previous}
            disabled={!previousEntry}
            title="Vorheriger Song"
            className="rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            ‹ Zurück
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!nextEntry}
            title="Nächster Song"
            className="rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Weiter ›
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={claimMaster}
          title="Dieses Gerät hat aktuell keine Kontrolle über die Queue"
          className="rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-accent hover:bg-control-strong-hover"
        >
          Master übernehmen
        </button>
      )}
    </div>
  )
}

export function NextSongConfigPanel({
  config,
  onChange,
}: {
  config: NextSongConfig
  onChange: (next: NextSongConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
