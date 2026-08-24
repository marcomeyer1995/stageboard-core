import { advanceToNextSong, useQueue } from '../lib/queue'
import { useShowStateStore } from '../store/useShowStateStore'

export function NextSongWidget() {
  const { currentSong, nextSong, isMaster } = useQueue()
  const claimMaster = useShowStateStore((state) => state.claimMaster)

  return (
    <div className="flex items-center justify-between rounded-lg bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
      <span>
        {currentSong ? (
          <>
            Aktuell: <span className="font-semibold text-white">{currentSong.title}</span>
          </>
        ) : (
          'Keine Songs vorhanden'
        )}
        {nextSong && (
          <>
            {' | '}
            Next: <span className="font-semibold text-white">{nextSong.title}</span>{' '}
            ({nextSong.bpm} BPM)
          </>
        )}
      </span>
      {isMaster ? (
        <button
          type="button"
          onClick={advanceToNextSong}
          disabled={!nextSong}
          className="rounded bg-neutral-700 px-3 py-1 font-medium text-white hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next Song
        </button>
      ) : (
        <button
          type="button"
          onClick={claimMaster}
          title="Diese Ansicht hat aktuell keine Kontrolle über die Queue"
          className="rounded bg-neutral-700 px-3 py-1 font-medium text-amber-400 hover:bg-neutral-600"
        >
          Master übernehmen
        </button>
      )}
    </div>
  )
}
