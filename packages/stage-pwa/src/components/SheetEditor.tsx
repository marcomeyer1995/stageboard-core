import { useEffect, useState } from 'react'
import { SongSchema, type Song } from 'shared-types'
import { parseChordPro } from '../lib/chordpro'
import { useSongsStore } from '../store/useSongsStore'
import { ChordProLyrics } from './ChordProLyrics'
import { TapToSync } from './TapToSync'

function emptyDraft(): Song {
  return {
    id: crypto.randomUUID(),
    title: '',
    bpm: 120,
    chordProContent: '',
    timecodes: [],
  }
}

export function SheetEditor() {
  const songs = useSongsStore((state) => state.songs)
  const saveSong = useSongsStore((state) => state.saveSong)
  const [draft, setDraft] = useState<Song>(() => songs[0] ?? emptyDraft())
  const [isNewDraft, setIsNewDraft] = useState(songs.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [isTapping, setIsTapping] = useState(false)

  useEffect(() => {
    // Only re-sync onto an existing song when we're *not* mid-editing a new,
    // unsaved draft - otherwise "+ Neuer Song" would get silently reverted.
    if (isNewDraft) return
    if (songs.length > 0 && !songs.some((song) => song.id === draft.id)) {
      setDraft(songs[0])
    }
  }, [songs, draft.id, isNewDraft])

  function selectSong(id: string) {
    const song = songs.find((s) => s.id === id)
    if (song) {
      setDraft(song)
      setIsNewDraft(false)
    }
    setError(null)
    setSavedAt(null)
  }

  async function handleSave() {
    const result = SongSchema.safeParse(draft)
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Ungültige Eingabe')
      return
    }
    setError(null)
    await saveSong(result.data)
    setSavedAt(Date.now())
    setIsNewDraft(false)
  }

  const preview = parseChordPro(draft.chordProContent)

  return (
    <div className="grid h-screen grid-cols-2 gap-3 bg-black p-3 text-white">
      <div className="flex flex-col gap-3 overflow-y-auto rounded-lg bg-neutral-900 p-4">
        <label className="flex flex-col gap-1 text-sm text-neutral-400">
          Song
          <select
            className="rounded bg-neutral-800 px-2 py-1 text-white"
            value={isNewDraft ? '' : draft.id}
            onChange={(e) => selectSong(e.target.value)}
          >
            {isNewDraft && <option value="">(neuer Song)</option>}
            {songs.map((song) => (
              <option key={song.id} value={song.id}>
                {song.title || '(ohne Titel)'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setDraft(emptyDraft())
            setIsNewDraft(true)
            setError(null)
            setSavedAt(null)
          }}
          className="self-start rounded bg-neutral-700 px-3 py-1 text-sm hover:bg-neutral-600"
        >
          + Neuer Song
        </button>
        <label className="flex flex-col gap-1 text-sm text-neutral-400">
          Titel
          <input
            className="rounded bg-neutral-800 px-2 py-1 text-white"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-neutral-400">
          BPM
          <input
            type="number"
            className="rounded bg-neutral-800 px-2 py-1 text-white"
            value={draft.bpm}
            onChange={(e) => setDraft({ ...draft, bpm: Number(e.target.value) })}
          />
        </label>
        {isTapping ? (
          <TapToSync
            content={draft.chordProContent}
            onComplete={(content) => {
              setDraft({ ...draft, chordProContent: content })
              setIsTapping(false)
            }}
            onCancel={() => setIsTapping(false)}
          />
        ) : (
          <label className="flex flex-1 flex-col gap-1 text-sm text-neutral-400">
            <div className="flex items-center justify-between">
              ChordPro-Text
              <button
                type="button"
                onClick={() => setIsTapping(true)}
                disabled={!draft.chordProContent.trim()}
                className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-white hover:bg-neutral-600 disabled:opacity-40"
              >
                Tap-to-Sync starten
              </button>
            </div>
            <textarea
              className="min-h-[240px] flex-1 rounded bg-neutral-800 p-2 font-mono text-sm text-white"
              value={draft.chordProContent}
              onChange={(e) => setDraft({ ...draft, chordProContent: e.target.value })}
              placeholder="[00:00.00] Come on baby [G] don't you wanna go"
            />
          </label>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="button"
          onClick={handleSave}
          className="rounded bg-amber-500 px-4 py-2 font-medium text-black hover:bg-amber-400"
        >
          Speichern
        </button>
        {savedAt && <p className="text-xs text-neutral-500">Gespeichert.</p>}
      </div>
      <div className="overflow-y-auto rounded-lg bg-neutral-900 p-6">
        <ChordProLyrics lines={preview} />
      </div>
    </div>
  )
}
