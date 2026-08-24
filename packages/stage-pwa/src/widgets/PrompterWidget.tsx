import { ChordProLyrics } from '../components/ChordProLyrics'
import { parseChordPro } from '../lib/chordpro'
import { useSongsStore } from '../store/useSongsStore'

export function PrompterWidget() {
  const currentSong = useSongsStore((state) => state.currentSong)

  if (!currentSong) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-neutral-900 p-8 text-neutral-500">
        Keine Songs vorhanden
      </div>
    )
  }

  const lines = parseChordPro(currentSong.chordProContent)

  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-lg bg-neutral-900 p-8">
      <p className="text-sm uppercase tracking-widest text-neutral-500">Now Playing</p>
      <h1 className="mt-2 text-4xl font-bold text-white">{currentSong.title}</h1>
      <ChordProLyrics lines={lines} />
    </div>
  )
}
