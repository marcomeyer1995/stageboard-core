import { useEffect, useRef, useState } from 'react'
import { SongSchema, SongVariantSchema, type Song, type SongVariant, type TimecodeMarker } from 'shared-types'
import { parseChordPro } from '../lib/chordpro'
import { randomId } from '../lib/id'
import { ensureDefaultVariant, getTrack } from '../lib/songVariantsDb'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { ChordProLyrics } from './ChordProLyrics'
import { TabImportOverlay, type ImportedSongData } from './TabImportOverlay'
import { TapToSync } from './TapToSync'
import { TrackManagerField } from './TrackManagerField'

/** The part labels docs/04 asks for as "große Buttons am Rand" of the editor. */
const PART_LABELS = ['Verse', 'Chorus', 'Bridge', 'Solo'] as const

/** The editor's working state: a song's title/artist plus one of its variant's playable
 * content - two separate documents (Song, SongVariant) presented as one form, since that's
 * how a musician thinks about "the song I'm editing right now". Key/tuning/capo live on the
 * variant, not the song, since a different arrangement can genuinely use a different one. */
interface EditorDraft {
  songId: string
  title: string
  artist?: string
  variantId: string
  variantLabel: string
  isDefaultVariant: boolean
  bpm: number
  chordProContent: string
  timecodes: TimecodeMarker[]
  key?: string
  tuning?: string
  capo?: number
}

function emptyDraft(): EditorDraft {
  return {
    songId: randomId(),
    title: '',
    variantId: randomId(),
    variantLabel: 'Original',
    isDefaultVariant: true,
    bpm: 120,
    chordProContent: '',
    timecodes: [],
  }
}

function draftFrom(song: Song, variant: SongVariant): EditorDraft {
  return {
    songId: song.id,
    title: song.title,
    artist: song.artist,
    variantId: variant.id,
    variantLabel: variant.label,
    isDefaultVariant: variant.isDefault,
    bpm: variant.bpm,
    chordProContent: variant.chordProContent,
    timecodes: variant.timecodes,
    key: variant.key,
    tuning: variant.tuning,
    capo: variant.capo,
  }
}

export function SheetEditor() {
  const songs = useSongsStore((state) => state.songs)
  const saveSong = useSongsStore((state) => state.saveSong)
  const variants = useSongVariantsStore((state) => state.variants)
  const saveVariant = useSongVariantsStore((state) => state.saveVariant)
  const [draft, setDraft] = useState<EditorDraft>(emptyDraft())
  const [isNewDraft, setIsNewDraft] = useState(true)
  const [initialSongLoaded, setInitialSongLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [isTapping, setIsTapping] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [tapTrackSrc, setTapTrackSrc] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const variantsForSong = variants.filter((v) => v.songId === draft.songId)
  const currentTracks = variants.find((v) => v.id === draft.variantId)?.tracks ?? []
  // Prefer the band's own mix; a reference track (e.g. extracted YouTube audio) is still
  // useful to tap along to when no band-mix has been recorded yet.
  const tapTrack =
    currentTracks.find((t) => t.kind === 'band-mix') ?? currentTracks.find((t) => t.kind === 'reference') ?? null

  useEffect(() => {
    setTapTrackSrc(null)
    if (!isTapping || !tapTrack) return
    let cancelled = false
    let objectUrl: string | null = null
    getTrack(draft.variantId, tapTrack.id).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setTapTrackSrc(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // Only the ids matter here - re-running on every tracks-array reference change (a new
    // array each render, since currentTracks is derived) would tear down/re-fetch needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTapping, draft.variantId, tapTrack?.id])

  async function selectSong(id: string) {
    const song = songs.find((s) => s.id === id)
    if (!song) return
    const variant = await ensureDefaultVariant(song)
    setDraft(draftFrom(song, variant))
    setIsNewDraft(false)
    setError(null)
    setSavedAt(null)
  }

  useEffect(() => {
    // First paint has no songs loaded from PouchDB yet - load the first one in once they
    // arrive, exactly once, so we don't fight a user who's already picked something else.
    if (initialSongLoaded || isNewDraft === false) return
    if (songs.length === 0) return
    setInitialSongLoaded(true)
    void selectSong(songs[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs, initialSongLoaded])

  useEffect(() => {
    // Only re-sync onto an existing song when we're *not* mid-editing a new,
    // unsaved draft - otherwise "+ Neuer Song" would get silently reverted.
    if (isNewDraft) return
    if (songs.length > 0 && !songs.some((song) => song.id === draft.songId)) {
      void selectSong(songs[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs, draft.songId, isNewDraft])

  function selectVariant(variantId: string) {
    const variant = variantsForSong.find((v) => v.id === variantId)
    if (!variant) return
    setDraft({
      ...draft,
      variantId: variant.id,
      variantLabel: variant.label,
      isDefaultVariant: variant.isDefault,
      bpm: variant.bpm,
      chordProContent: variant.chordProContent,
      timecodes: variant.timecodes,
      key: variant.key,
      tuning: variant.tuning,
      capo: variant.capo,
    })
    setError(null)
    setSavedAt(null)
  }

  function addVariant() {
    setDraft({
      ...draft,
      variantId: randomId(),
      variantLabel: 'Neue Variante',
      isDefaultVariant: false,
    })
    setError(null)
    setSavedAt(null)
  }

  async function handleSave() {
    const variant: SongVariant = {
      id: draft.variantId,
      songId: draft.songId,
      label: draft.variantLabel.trim() || 'Original',
      isDefault: draft.isDefaultVariant,
      bpm: draft.bpm,
      chordProContent: draft.chordProContent,
      timecodes: draft.timecodes,
      tracks: currentTracks,
      key: draft.key,
      tuning: draft.tuning,
      capo: draft.capo,
    }
    const variantResult = SongVariantSchema.safeParse(variant)
    if (!variantResult.success) {
      setError(variantResult.error.issues[0]?.message ?? 'Ungültige Eingabe')
      return
    }

    // Song.bpm/chordProContent/timecodes are a read-compatibility mirror of the *default*
    // variant, not whatever variant happens to be open right now - every widget that hasn't
    // been migrated to read variants directly still reads these fields.
    const defaultVariant = draft.isDefaultVariant ? variant : variantsForSong.find((v) => v.isDefault)
    const song: Song = {
      id: draft.songId,
      title: draft.title,
      artist: draft.artist,
      bpm: defaultVariant?.bpm ?? draft.bpm,
      chordProContent: defaultVariant?.chordProContent ?? draft.chordProContent,
      timecodes: defaultVariant?.timecodes ?? draft.timecodes,
    }
    const songResult = SongSchema.safeParse(song)
    if (!songResult.success) {
      setError(songResult.error.issues[0]?.message ?? 'Ungültige Eingabe')
      return
    }

    setError(null)
    await saveSong(songResult.data)
    await saveVariant(variantResult.data)
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

  /** Ultimate Guitar's own bpm/key/tuning/capo only ever come in on top of whatever the
   * import found - a missing field there must not silently overwrite a value already in the
   * editor (e.g. a capo the previous variant had that this particular tab just doesn't list). */
  function handleImport(imported: ImportedSongData) {
    setDraft({
      ...draft,
      chordProContent: imported.chordProContent,
      artist: imported.artist ?? draft.artist,
      key: imported.key ?? draft.key,
      tuning: imported.tuning ?? draft.tuning,
      capo: imported.capo ?? draft.capo,
      bpm: imported.bpm ?? draft.bpm,
    })
  }

  const preview = parseChordPro(draft.chordProContent)

  return (
    <div className="grid h-dvh grid-cols-2 gap-3 sb-app-bg p-3 text-ink">
      <div className="flex flex-col gap-3 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb">
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Song
          <select
            className="rounded-sb-sm bg-control px-2 py-1 text-ink"
            value={isNewDraft ? '' : draft.songId}
            onChange={(e) => void selectSong(e.target.value)}
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
          className="self-start rounded-sb-sm bg-control-strong px-3 py-1 text-sm hover:bg-control-strong-hover"
        >
          + Neuer Song
        </button>
        {!isNewDraft && (
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Variante
            <div className="flex items-center gap-2">
              <select
                className="flex-1 rounded-sb-sm bg-control px-2 py-1 text-ink"
                value={draft.variantId}
                onChange={(e) => selectVariant(e.target.value)}
              >
                {!variantsForSong.some((v) => v.id === draft.variantId) && (
                  <option value={draft.variantId}>{draft.variantLabel} (neu)</option>
                )}
                {variantsForSong.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addVariant}
                className="rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink hover:bg-control-strong-hover"
              >
                + Neue Variante
              </button>
            </div>
          </label>
        )}
        {!draft.isDefaultVariant && (
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Varianten-Name
            <input
              className="rounded-sb-sm bg-control px-2 py-1 text-ink"
              value={draft.variantLabel}
              onChange={(e) => setDraft({ ...draft, variantLabel: e.target.value })}
            />
          </label>
        )}
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm text-ink-muted">
            Titel
            <input
              className="rounded-sb-sm bg-control px-2 py-1 text-ink"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm text-ink-muted">
            Band
            <input
              className="rounded-sb-sm bg-control px-2 py-1 text-ink"
              value={draft.artist ?? ''}
              onChange={(e) => setDraft({ ...draft, artist: e.target.value || undefined })}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm text-ink-muted">
            BPM
            <input
              type="number"
              className="rounded-sb-sm bg-control px-2 py-1 text-ink"
              value={draft.bpm}
              onChange={(e) => setDraft({ ...draft, bpm: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm text-ink-muted">
            Key
            <input
              className="rounded-sb-sm bg-control px-2 py-1 text-ink"
              value={draft.key ?? ''}
              onChange={(e) => setDraft({ ...draft, key: e.target.value || undefined })}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm text-ink-muted">
            Tuning
            <input
              className="rounded-sb-sm bg-control px-2 py-1 text-ink"
              value={draft.tuning ?? ''}
              onChange={(e) => setDraft({ ...draft, tuning: e.target.value || undefined })}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm text-ink-muted">
            Capo
            <input
              type="number"
              min={0}
              className="rounded-sb-sm bg-control px-2 py-1 text-ink"
              value={draft.capo ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, capo: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </label>
        </div>
        <TrackManagerField variantId={draft.variantId} tracks={currentTracks} disabled={isNewDraft} />
        {isTapping ? (
          <TapToSync
            content={draft.chordProContent}
            trackSrc={tapTrackSrc}
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
              <span className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setIsImporting(true)}
                  className="rounded-sb-sm bg-control-strong px-2 py-0.5 text-xs text-ink hover:bg-control-strong-hover"
                >
                  Song importieren
                </button>
                <button
                  type="button"
                  onClick={() => setIsTapping(true)}
                  disabled={!draft.chordProContent.trim()}
                  className="rounded-sb-sm bg-control-strong px-2 py-0.5 text-xs text-ink hover:bg-control-strong-hover disabled:opacity-40"
                >
                  Tap-to-Sync starten
                </button>
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {PART_LABELS.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => insertPart(label)}
                  className="rounded-sb-sm bg-control-strong px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent hover:bg-control-strong-hover"
                >
                  + {label}
                </button>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              className="min-h-[240px] flex-1 rounded-sb-sm bg-control p-2 font-sb-mono text-sm text-ink"
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
          className="rounded-sb-sm bg-accent-2 px-4 py-2 font-medium text-accent-ink hover:bg-accent-2-hover"
        >
          Speichern
        </button>
        {savedAt && <p className="text-xs text-ink-faint">Gespeichert.</p>}
      </div>
      <div className="overflow-y-auto rounded-sb border border-line bg-surface p-6 shadow-sb">
        <ChordProLyrics lines={preview} />
      </div>
      {isImporting && <TabImportOverlay onImport={handleImport} onClose={() => setIsImporting(false)} />}
    </div>
  )
}
