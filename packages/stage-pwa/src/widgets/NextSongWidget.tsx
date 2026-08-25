import { advanceToNextSong, useQueue } from '../lib/queue'
import { useShowStateStore } from '../store/useShowStateStore'

export function NextSongWidget() {
  const { currentSong, nextSong, isMaster } = useQueue()
  const claimMaster = useShowStateStore((state) => state.claimMaster)

  return (
    <div className="flex items-center justify-between rounded-lg bg-surface px-4 py-3 text-sm text-ink-soft">
      <span>
        {currentSong ? (
          <>
            Aktuell: <span className="font-semibold text-ink">{currentSong.title}</span>
          </>
        ) : (
          'Keine Songs vorhanden'
        )}
        {nextSong && (
          <>
            {' | '}
            Next: <span className="font-semibold text-ink">{nextSong.title}</span>{' '}
            ({nextSong.bpm} BPM)
          </>
        )}
      </span>
      {isMaster ? (
        <button
          type="button"
          onClick={advanceToNextSong}
          disabled={!nextSong}
          className="rounded bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next Song
        </button>
      ) : (
        <button
          type="button"
          onClick={claimMaster}
          title="Diese Ansicht hat aktuell keine Kontrolle über die Queue"
          className="rounded bg-control-strong px-3 py-1 font-medium text-accent hover:bg-control-strong-hover"
        >
          Master übernehmen
        </button>
      )}
    </div>
  )
}
