import { useShowPart } from '../lib/widgetParts'
import { useTouchSizes } from '../components/ui/PrepTier'
import { isHeadingEntry, isSongEntry, type SetlistEntry } from 'shared-types'
import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type NextSongConfig } from './nextSongConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { MasterTakeoverButton } from '../components/MasterTakeoverButton'
import { stageFontSize } from '../lib/stageSize'
import { lineHeightFor, nextSongLayout } from '../lib/gigWidgetLayout'
import { useElementSize } from '../lib/useElementSize'
import { Icon } from '../components/Icon'
import { useDashboardHasWidget } from '../lib/dashboardWidgets'
import { stageVariantLabel } from '../lib/variantLabel'

/** What to call a non-song queue entry on screen. */
function itemLabel(entry: SetlistEntry): string {
  return isHeadingEntry(entry) ? 'Abschnitt' : 'Ansage'
}

/** Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco, 2026-09-14). */
export function NextSongWidget({ config }: { config: NextSongConfig }) {
  const { queue, canControl, next, previous } = useShowMode()
  // The takeover lives in the transport when the dashboard has one (2026-10-16): here it squeezed
  // the info to "Aktuel… / Next…" on the phone - without control this stays the flat bar (docs/07).
  const takeoverElsewhere = useDashboardHasWidget('show-transport')
  const { previousEntry, currentEntry, nextEntry, currentSong, nextSong, currentVariant, nextVariant } = queue
  const currentItem = currentEntry && !isSongEntry(currentEntry) ? currentEntry : null
  const nextItem = nextEntry && !isSongEntry(nextEntry) ? nextEntry : null
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  const [boxRef, box] = useElementSize()
  const touchSizes = useTouchSizes()
  const layout = nextSongLayout(box.width, box.height, lineHeightFor(fontSize), touchSizes)
  // Buttons fill the widget's height (or the row under the info when stacked), at least the
  // touch size - "Weiter" is the action hit mid-show (lib/gigWidgetLayout.ts).
  const buttonClass = `h-full min-h-touch min-w-touch rounded-control bg-control-strong px-4 font-bold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40`

  // Each line can be hidden in the ⋯ menu (Marco, 2026-10-17); with both off only the buttons stay.
  const showCurrent = useShowPart('current')
  const showNext = useShowPart('next')
  const current = !showCurrent ? null : currentItem ? (
    <>
      {itemLabel(currentItem)}: <span className="font-semibold text-ink">{currentItem.title}</span>
    </>
  ) : currentSong ? (
    <>
      Aktuell: <span className="font-semibold text-ink">{currentSong.title}</span>
      {currentVariant && !currentVariant.isDefault && (
        <span className="ml-1 text-[length:max(var(--sb-text-min),0.6em)] text-accent">({stageVariantLabel(currentVariant.label)})</span>
      )}
    </>
  ) : (
    'Keine Songs vorhanden'
  )
  const upcoming = !showNext ? null : nextItem ? (
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
      {(current || upcoming) && (
        <div style={{ fontSize }} className={`flex min-w-0 flex-col justify-center ${layout.stacked ? '' : 'flex-1'}`}>
          {layout.twoLines || !current || !upcoming ? (
            <>
              {current && <span className="truncate">{current}</span>}
              {upcoming && <span className="truncate">{upcoming}</span>}
            </>
          ) : (
            <span className="truncate">
              {current}
              {' | '}
              {upcoming}
            </span>
          )}
        </div>
      )}
      {canControl ? (
        <div className={`flex gap-2 ${layout.stacked ? 'min-h-0 flex-1' : ''}`}>
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
      ) : takeoverElsewhere ? null : (
        <MasterTakeoverButton className="min-h-touch rounded-control bg-control-strong px-4 font-semibold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover" />
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
