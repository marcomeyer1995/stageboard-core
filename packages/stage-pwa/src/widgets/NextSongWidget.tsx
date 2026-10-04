import { isHeadingEntry, isSongEntry, type SetlistEntry } from 'shared-types'
import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type NextSongConfig } from './nextSongConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { MasterTakeoverButton } from '../components/MasterTakeoverButton'
import { ReadyCheckControl } from '../components/ReadyCheckControl'
import { stageFontSize } from '../lib/stageSize'
import { lineHeightFor, nextSongLayout } from '../lib/gigWidgetLayout'
import { useElementSize } from '../lib/useElementSize'
import { Icon } from '../components/Icon'

/** What to call a non-song queue entry on screen. */
function itemLabel(entry: SetlistEntry): string {
  return isHeadingEntry(entry) ? 'Abschnitt' : 'Ansage'
}

/** Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco, 2026-09-14). */
export function NextSongWidget({ config }: { config: NextSongConfig }) {
  const { queue, canControl, next, previous } = useShowMode()
  const { previousEntry, currentEntry, nextEntry, currentSong, nextSong, currentVariant, nextVariant } = queue
  const currentItem = currentEntry && !isSongEntry(currentEntry) ? currentEntry : null
  const nextItem = nextEntry && !isSongEntry(nextEntry) ? nextEntry : null
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  const [boxRef, box] = useElementSize()
  const layout = nextSongLayout(box.width, box.height, lineHeightFor(fontSize))
  // Buttons fill the widget's height (or the row under the info when stacked), at least the
  // touch size - "Weiter" is the action hit mid-show (lib/gigWidgetLayout.ts).
  const buttonClass = `h-full min-h-touch min-w-touch rounded-sb bg-control-strong px-4 font-bold text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40`

  const current = currentItem ? (
    <>
      {itemLabel(currentItem)}: <span className="font-semibold text-ink">{currentItem.title}</span>
    </>
  ) : currentSong ? (
    <>
      Aktuell: <span className="font-semibold text-ink">{currentSong.title}</span>
      {currentVariant && !currentVariant.isDefault && (
        <span className="ml-1 text-[length:max(var(--sb-text-min),0.6em)] text-accent">({currentVariant.label})</span>
      )}
    </>
  ) : (
    'Keine Songs vorhanden'
  )
  const upcoming = nextItem ? (
    <>
      Next: <span className="font-semibold text-ink">{nextItem.title}</span> ({itemLabel(nextItem)})
    </>
  ) : nextSong ? (
    <>
      Next: <span className="font-semibold text-ink">{nextSong.title}</span> ({(nextVariant ?? nextSong).bpm} BPM)
      {nextVariant && !nextVariant.isDefault && (
        <span className="ml-1 text-[length:max(var(--sb-text-min),0.6em)] text-accent">({nextVariant.label})</span>
      )}
    </>
  ) : null

  return (
    <div
      ref={boxRef}
      className={`flex h-full gap-2 text-ink-soft ${layout.stacked ? 'flex-col' : 'items-stretch justify-between'}`}
    >
      <div style={{ fontSize }} className={`flex min-w-0 flex-col justify-center ${layout.stacked ? '' : 'flex-1'}`}>
        {layout.twoLines ? (
          <>
            <span className="truncate">{current}</span>
            {upcoming && <span className="truncate">{upcoming}</span>}
          </>
        ) : (
          <span className="truncate">
            {current}
            {upcoming && <>{' | '}{upcoming}</>}
          </span>
        )}
      </div>
      {canControl ? (
        <div className={`flex gap-2 ${layout.stacked ? 'min-h-0 flex-1' : ''}`}>
          <ReadyCheckControl compact={layout.shortLabels} buttonClassName={buttonClass} />
          <button type="button" onClick={previous} disabled={!previousEntry} title="Vorheriger Song" className={`${buttonClass} ${layout.stacked ? 'flex-1' : ''}`}>
            {layout.shortLabels ? (
              <Icon name="previous" size="2.25rem" />
            ) : (
              <span className="flex items-center justify-center gap-1">
                <Icon name="previous" /> Zurück
              </span>
            )}
          </button>
          <button type="button" onClick={next} disabled={!nextEntry} title="Nächster Song" className={`${buttonClass} ${layout.stacked ? 'flex-1' : ''}`}>
            {layout.shortLabels ? (
              <Icon name="next" size="2.25rem" />
            ) : (
              <span className="flex items-center justify-center gap-1">
                Weiter <Icon name="next" />
              </span>
            )}
          </button>
        </div>
      ) : (
        <MasterTakeoverButton className="min-h-touch rounded-sb bg-control-strong px-4 font-bold text-accent hover:bg-control-strong-hover" />
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
