import { useAutoFitFontSize } from '../lib/useAutoFitFontSize'
import { useShowMode } from '../lib/showMode'
import { useShowStateStore } from '../store/useShowStateStore'

export function NextSongWidget() {
  const { queue, canControl, next, previous } = useShowMode()
  const { previousSong, currentSong, nextSong, currentVariant, nextVariant } = queue
  const claimMaster = useShowStateStore((state) => state.claimMaster)

  // A JS auto-fit spike (#22 follow-up) against VisualMetronomeWidget's CSS container-query
  // approach - re-measures the actual rendered text (title length varies a lot, unlike a
  // fixed-vocabulary label a cq unit alone would size fine), so this fits the label's real
  // content rather than just scaling with the container's own box.
  const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLDivElement, HTMLSpanElement>(
    { min: 10, max: 96 },
    [currentSong?.id, nextSong?.id, currentVariant?.label, nextVariant?.label],
  )

  return (
    <div className="flex h-full items-center justify-between gap-2 text-ink-soft">
      {/* h-full, not just flex-1: the outer row centers its items on the cross axis
          (items-center), which does NOT stretch a flex item to the parent's height - without
          an explicit height this div sized itself to its own text content instead, so
          clientHeight only ever measured "whatever the text currently needs", never a real
          ceiling. That let the binary search treat height as unconstrained and walk font-size
          all the way to `max` regardless of the widget's actual box (Marco, 2026-09-14: "keine
          Größenänderung erkennbar... viel zu groß"). */}
      <div ref={containerRef} className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
        <span ref={textRef} style={{ fontSize }} className="whitespace-nowrap">
          {currentSong ? (
            <>
              Aktuell: <span className="font-semibold text-ink">{currentSong.title}</span>
              {currentVariant && !currentVariant.isDefault && (
                <span className="ml-1 text-[0.6em] text-accent">({currentVariant.label})</span>
              )}
            </>
          ) : (
            'Keine Songs vorhanden'
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
            disabled={!previousSong}
            title="Vorheriger Song"
            className="rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            ‹ Zurück
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!nextSong}
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
