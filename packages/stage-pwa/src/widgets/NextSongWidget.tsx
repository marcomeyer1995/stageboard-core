import { useShowStore } from '../store/useShowStore'

export function NextSongWidget() {
  const currentSong = useShowStore((state) => state.currentSong)
  const nextSong = useShowStore((state) => state.nextSong)
  const advanceToNextSong = useShowStore((state) => state.advanceToNextSong)

  return (
    <div className="flex items-center justify-between rounded-lg bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
      <span>
        Aktuell: <span className="font-semibold text-white">{currentSong.title}</span>
        {nextSong && (
          <>
            {' | '}
            Next: <span className="font-semibold text-white">{nextSong.title}</span>{' '}
            ({nextSong.bpm} BPM)
          </>
        )}
      </span>
      <button
        type="button"
        onClick={advanceToNextSong}
        disabled={!nextSong}
        className="rounded bg-neutral-700 px-3 py-1 font-medium text-white hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next Song
      </button>
    </div>
  )
}
