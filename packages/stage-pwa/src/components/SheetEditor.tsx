import { useEffect, useRef, useState } from 'react'
import { SongSchema, type Song } from 'shared-types'
import { parseChordPro } from '../lib/chordpro'
import { useSongsStore } from '../store/useSongsStore'
import { ChordProLyrics } from './ChordProLyrics'
import { TapToSync } from './TapToSync'

/** The part labels docs/04 asks for as "große Buttons am Rand" of the editor. */
const PART_LABELS = ['Verse', 'Chorus', 'Bridge', 'Solo'] as const

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  /** Marks the block starting at the caret as a song part by inserting a `{part: ...}` directive. */
  function insertPart(label: string) {
    const textarea = textareaRef.current
    const content = draft.chordProContent
    const caret = textarea?.selectionStart ?? content.length
    // Directives own a whole line, so snap to the start of the line the caret sits in.
    const lineStart = content.lastIndexOf('\n', caret - 1) + 1
    const directive = `{part: ${label}}\n`
    setDraft({
      ...draft,
      chordProContent: content.slice(0, lineStart) + directive + content.slice(lineStart),
    })
    requestAnimationFrame(() => {
      const caretAfter = lineStart + directive.length
      textarea?.focus()
      textarea?.setSelectionRange(caretAfter, caretAfter)
    })
  }

  const preview = parseChordPro(draft.chordProContent)

  return (
    <div className="grid h-screen grid-cols-2 gap-3 bg-stage p-3 text-ink">
      <div className="flex flex-col gap-3 overflow-y-auto rounded-lg bg-surface p-4">
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Song
          <select
            className="rounded bg-control px-2 py-1 text-ink"
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
          className="self-start rounded bg-control-strong px-3 py-1 text-sm hover:bg-control-strong-hover"
        >
          + Neuer Song
        </button>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Titel
          <input
            className="rounded bg-control px-2 py-1 text-ink"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          BPM
          <input
            type="number"
            className="rounded bg-control px-2 py-1 text-ink"
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
          <label className="flex flex-1 flex-col gap-1 text-sm text-ink-muted">
            <div className="flex items-center justify-between">
              ChordPro-Text
              <button
                type="button"
                onClick={() => setIsTapping(true)}
                disabled={!draft.chordProContent.trim()}
                className="rounded bg-control-strong px-2 py-0.5 text-xs text-ink hover:bg-control-strong-hover disabled:opacity-40"
              >
                Tap-to-Sync starten
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {PART_LABELS.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => insertPart(label)}
                  className="rounded bg-control-strong px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent hover:bg-control-strong-hover"
                >
                  + {label}
                </button>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              className="min-h-[240px] flex-1 rounded bg-control p-2 font-mono text-sm text-ink"
              value={draft.chordProContent}
              onChange={(e) => setDraft({ ...draft, chordProContent: e.target.value })}
              placeholder="[00:00.00] Come on baby [G] don't you wanna go"
            />
          </label>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="button"
          onClick={handleSave}
          className="rounded bg-amber-500 px-4 py-2 font-medium text-black hover:bg-amber-400"
        >
          Speichern
        </button>
        {savedAt && <p className="text-xs text-ink-faint">Gespeichert.</p>}
      </div>
      <div className="overflow-y-auto rounded-lg bg-surface p-6">
        <ChordProLyrics lines={preview} />
      </div>
    </div>
  )
}
