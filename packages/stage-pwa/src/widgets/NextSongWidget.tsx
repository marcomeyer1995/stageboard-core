import { useShowMode } from '../lib/showMode'
import { useShowStateStore } from '../store/useShowStateStore'

export function NextSongWidget() {
  const { queue, canControl, next, previous } = useShowMode()
  const { previousSong, currentSong, nextSong, currentVariant, nextVariant } = queue
  const claimMaster = useShowStateStore((state) => state.claimMaster)

  return (
    <div className="flex h-full items-center justify-between text-sm text-ink-soft">
      <span>
        {currentSong ? (
          <>
            Aktuell: <span className="font-semibold text-ink">{currentSong.title}</span>
            {currentVariant && !currentVariant.isDefault && (
              <span className="ml-1 text-xs text-accent">({currentVariant.label})</span>
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
              <span className="ml-1 text-xs text-accent">({nextVariant.label})</span>
            )}
          </>
        )}
      </span>
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
