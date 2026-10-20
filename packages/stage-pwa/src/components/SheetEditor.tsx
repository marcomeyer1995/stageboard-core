import { useEffect, useRef, useState } from 'react'
import {
  SongSchema,
  SongVariantSchema,
  CAPABILITIES,
  isSongEntry,
  type BeatGrid,
  type Song,
  type ShowCue,
  type SongVariant,
  type TimecodeMarker,
  type Tuning,
} from 'shared-types'
import { analyzeTrackBlob } from '../lib/analyzeTrack'
import { clickTimeline, gridFromBeats, gridStretches } from '../lib/beatGrid'
import { formatTimelineTime } from '../lib/timeline'
import { pluginProviding } from '../lib/capabilities'
import { parseChordPro, sourcePosition } from '../lib/chordpro'
import { randomId } from '../lib/id'
import { isStandard, parseTuning, signedSteps, soundingKey, stageTuning, tuningLabel, variantChordShift } from '../lib/pitch'
import { KeyTuningField } from './KeyTuningField'
import { TuningSelect } from './TuningSelect'
import { deleteVariant, getTrack, setDefaultVariant, variantToOpen } from '../lib/songVariantsDb'
import { useIsPanelLayout } from '../lib/useIsPanelLayout'
import { useDialogStore } from '../store/useDialogStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useEditingTitleStore } from '../store/useEditingTitleStore'
import { ChordProLyrics } from './ChordProLyrics'
import { CommentListEditor } from './CommentListEditor'
import { TabImportOverlay, type ImportedSongData } from './TabImportOverlay'
import { TrackManagerField } from './TrackManagerField'
import { TimelineEditor } from './timeline/TimelineEditor'
import { useBackHandler } from '../lib/backNavigation'
import { confirmLeave, useUnsavedChangesGuard } from '../lib/unsavedChanges'
import { Icon } from './Icon'
import { ActionMenu, ActionMenuDialog, AddRow, Switch, Tabs, Button, type MenuAction } from './ui'
import { INPUT, INPUT_FREE } from './ui/styles'
import { askAnalysisSource, playableTracks, stemsForTrack } from '../lib/stems'

/** An old/imported tuning text as draft fields: read into chartTuning, or kept as text when it can't be. */
function tuningFromText(text: string): Pick<EditorDraft, 'chartTuning' | 'tuning'> {
  const parsed = parseTuning(text)
  return parsed ? { chartTuning: isStandard(parsed) ? undefined : parsed, tuning: undefined } : { chartTuning: undefined, tuning: text }
}

function variantTuningDraft(variant: SongVariant): Pick<EditorDraft, 'tuningSpec' | 'chartTuning' | 'tuning'> {
  if (variant.chartTuning) return { tuningSpec: variant.tuningSpec, chartTuning: variant.chartTuning, tuning: undefined }
  return { tuningSpec: variant.tuningSpec, ...(variant.tuning ? tuningFromText(variant.tuning) : { chartTuning: undefined, tuning: undefined }) }
}

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
  timeSignature: string
  clickTrackEnabled: boolean
  chordProContent: string
  timecodes: TimecodeMarker[]
  cues: ShowCue[]
  /** The rigid click grid (docs/14 §5a) - carried through unchanged until the timeline edits it. */
  beatGrid?: BeatGrid
  countInEnabled: boolean
  countInBars: number
  /** Hand-entered playing length in ms (Festival Clock, #28). */
  durationMs?: number
  key?: string
  /** Old free text (what the chart is written for) - kept only while it can't be read. */
  tuning?: string
  capo?: number
  tuningSpec?: Tuning
  chartTuning?: Tuning
  transpose?: number
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
    timeSignature: variant.timeSignature,
    clickTrackEnabled: variant.clickTrackEnabled,
    chordProContent: variant.chordProContent,
    timecodes: variant.timecodes,
    cues: variant.cues,
    beatGrid: variant.beatGrid,
    countInEnabled: variant.countInEnabled,
    countInBars: variant.countInBars,
    durationMs: variant.durationMs,
    key: variant.key,
    ...variantTuningDraft(variant),
    capo: variant.capo,
    transpose: variant.transpose,
  }
}

type EditorLayout = 'stacked' | 'panel'

/** Landscape/desktop ('panel', useIsPanelLayout.ts - shared with LibraryView.tsx) put the preview
 * in its own column; phone and tablet portrait stack everything in one. Both use the same
 * accordions (#603 - the portrait tab strip ran off the screen). */
function useEditorLayout(): EditorLayout {
  return useIsPanelLayout() ? 'panel' : 'stacked'
}

interface SheetEditorProps {
  /** Controlled selection from LibraryView's tree (#20) - LibraryView is the only caller, and
   * always supplies a real, already-saved song (creation/deletion/switching now live there
   * too, not inside this editor - see LibraryView.tsx's own "+ Neu" and per-row menu).
   * `variantId: null` means the song's default variant, matching SetlistEntry's convention. */
  songId: string
  variantId: string | null
  /** Also doubles as the escape hatch if the open song vanishes out from under this screen
   * (deleted here or on another device mid-sync) - see the "song no longer exists" effect
   * below. */
  onBack: () => void
}

export function SheetEditor({ songId, variantId, onBack }: SheetEditorProps) {
  const songs = useSongsStore((state) => state.songs)
  const saveSong = useSongsStore((state) => state.saveSong)
  const variants = useSongVariantsStore((state) => state.variants)
  const setlists = useSetlistsStore((state) => state.setlists)
  const saveVariant = useSongVariantsStore((state) => state.saveVariant)
  const confirm = useDialogStore((state) => state.confirm)
  const promptFields = useDialogStore((state) => state.promptFields)
  const installedPlugins = usePluginsStore((state) => state.installed)
  // null only until the first `selectSong` resolves - there's no more "new, unsaved song"
  // state to represent here, since creation now happens in LibraryView before this editor
  // ever opens (it always receives a real songId for a song that already exists).
  const [draft, setDraft] = useState<EditorDraft | null>(null)
  /** The draft as last loaded or saved (JSON) - the baseline for `dirty`. */
  const savedDraft = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // "Tap-to-Sync" opens the timeline straight into "Zeilen tippen" (#325) - the one place lines are tapped.
  const [tapLinesOnOpen, setTapLinesOnOpen] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [insertMenuOpen, setInsertMenuOpen] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [tapTrackSrc, setTapTrackSrc] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const layout = useEditorLayout()
  // Titel/Band/Key/Capo/Stimmung (#603): a one-line summary until opened. null = not touched yet:
  // open in landscape/desktop and for a song without a title (a new one), closed otherwise.
  const [metaOpen, setMetaOpen] = useState<boolean | null>(null)
  // Every section starts collapsed (Marco, explicit request) - opening a song for editing
  // shows just the always-visible header (Titel/Band/Key/Tuning/Capo) until something is
  // deliberately expanded, not a screenful of whichever section used to default open.
  const [textExpanded, setTextExpanded] = useState(false)
  // A tapped preview line's position in the text (#607) - applied once the text field is there,
  // since the Text section may first have to open.
  const [jumpTo, setJumpTo] = useState<number | null>(null)
  useEffect(() => {
    const textarea = textareaRef.current
    if (jumpTo === null || !textarea) return
    setJumpTo(null)
    // Scroll the field so the line sits a third from its top: measure the text up to the caret
    // with the field's own wrapping, then put the content back (no input event - React's value
    // stays as it is).
    const value = textarea.value
    textarea.value = value.slice(0, jumpTo)
    const caretTop = textarea.scrollHeight
    textarea.value = value
    textarea.scrollTop = Math.max(0, caretTop - textarea.clientHeight / 3)
    textarea.focus({ preventScroll: true })
    textarea.setSelectionRange(jumpTo, jumpTo)
    textarea.scrollIntoView?.({ block: 'nearest' })
  }, [jumpTo, textExpanded])
  const [tempoExpanded, setTempoExpanded] = useState(false)
  const [audioExpanded, setAudioExpanded] = useState(false)
  const [commentsExpanded, setCommentsExpanded] = useState(false)
  // Two views of the same draft (docs/14): the text editor (what) and the full-screen timeline
  // (when) - not a section squeezed into the details column.
  const [editorView, setEditorView] = useState<'text' | 'timeline'>('text')

  const variantsForSong = draft ? variants.filter((v) => v.songId === draft.songId) : []
  const currentTracks = draft ? (variants.find((v) => v.id === draft.variantId)?.tracks ?? []) : []
  // Prefer the band's own mix; a reference track (e.g. extracted YouTube audio) is still
  // useful to tap along to when no band-mix has been recorded yet.
  const tapTrack =
    currentTracks.find((t) => t.kind === 'band-mix') ?? currentTracks.find((t) => t.kind === 'reference') ?? null

  // The status bar names the song being edited while this page is open (#603).
  const setEditingTitle = useEditingTitleStore((state) => state.setEditing)
  const editingTitle = draft ? draft.title.trim() || '(ohne Titel)' : null
  const editingVariant = draft?.variantLabel ?? ''
  useEffect(() => {
    setEditingTitle(editingTitle === null ? null : { title: editingTitle, variantLabel: editingVariant })
  }, [setEditingTitle, editingTitle, editingVariant])
  useEffect(() => () => setEditingTitle(null), [setEditingTitle])

  useEffect(() => {
    setTapTrackSrc(null)
    const timelineOpen = editorView === 'timeline'
    if (!draft || !timelineOpen || !tapTrack) return
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
  }, [editorView, draft?.variantId, tapTrack?.id])

  async function selectSong(id: string, preferredVariantId?: string | null) {
    const song = songs.find((s) => s.id === id)
    if (!song) return
    const variant = await variantToOpen(song, preferredVariantId ?? null)
    const loaded = draftFrom(song, variant)
    setDraft(loaded)
    savedDraft.current = JSON.stringify(loaded)
    setError(null)
    setSavedAt(null)
  }

  // Also re-runs once the song shows up in the store: LibraryView's "+ Neu" saves a brand-new
  // song and opens this editor right away, but the songs store only picks it up a moment later
  // (PouchDB change feed -> refreshSongs). Without `songLoaded` here the first run found no
  // song, and nothing ever ran it again - the editor sat on "Lade…" for good.
  const songLoaded = songs.some((s) => s.id === songId)
  useEffect(() => {
    if (songLoaded) void selectSong(songId, variantId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, variantId, songLoaded])

  // Unsaved changes (#341): the draft differs from what was last loaded or saved. Leaving asks
  // first - via Back, "← Bibliothek", reload or closing the tab.
  const dirty = draft !== null && savedDraft.current !== null && JSON.stringify(draft) !== savedDraft.current
  // Every way out asks "Speichern / Verwerfen / Weiter bearbeiten" while dirty (lib/unsavedChanges).
  const saveRef = useRef<() => Promise<boolean>>(async () => false)
  useUnsavedChangesGuard(dirty, () => saveRef.current())
  const leave = async () => {
    if (await confirmLeave()) onBack()
  }
  // Back closes the current view: the timeline returns to the text view, the editor to the library.
  useBackHandler(editorView === 'timeline' ? () => setEditorView('text') : () => void leave())

  useEffect(() => {
    // The open song was deleted - here, or on another device mid-sync. There's nothing left
    // to silently fall back to (LibraryView, not this editor, now owns "which song is open"),
    // so leave rather than show a stale/blank form.
    if (!draft) return
    if (songs.length > 0 && !songs.some((song) => song.id === draft.songId)) {
      onBack()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs, draft?.songId])

  if (!draft) {
    return <div className="flex h-full items-center justify-center text-ink-faint">Lade…</div>
  }

  const selectVariant = (variantId: string) => {
    const variant = variantsForSong.find((v) => v.id === variantId)
    if (!variant) return
    const next: EditorDraft = {
      ...draft,
      variantId: variant.id,
      variantLabel: variant.label,
      isDefaultVariant: variant.isDefault,
      bpm: variant.bpm,
      timeSignature: variant.timeSignature,
      clickTrackEnabled: variant.clickTrackEnabled,
      chordProContent: variant.chordProContent,
      timecodes: variant.timecodes,
      cues: variant.cues,
      beatGrid: variant.beatGrid,
      countInEnabled: variant.countInEnabled,
      countInBars: variant.countInBars,
      durationMs: variant.durationMs,
      key: variant.key,
      ...variantTuningDraft(variant),
      capo: variant.capo,
      transpose: variant.transpose,
    }
    setDraft(next)
    // Switching variants loads that variant as saved - its own baseline.
    savedDraft.current = JSON.stringify(next)
    setError(null)
    setSavedAt(null)
  }

  const addVariant = () => {
    setDraft({
      ...draft,
      variantId: randomId(),
      variantLabel: 'Neue Variante',
      isDefaultVariant: false,
    })
    setError(null)
    setSavedAt(null)
  }

  // Delete and "Als Standard" (Marco, 2026-10-18): only for a variant that is saved already.
  const variantSaved = variantsForSong.some((v) => v.id === draft.variantId)
  const hasDefault = variantsForSong.some((v) => v.isDefault)

  const handleDeleteVariant = async () => {
    const usedIn = setlists.filter((setlist) => setlist.entries.some((entry) => isSongEntry(entry) && entry.variantId === draft.variantId))
    const lines = [`Variante „${draft.variantLabel}“ mit ihren Audio-Spuren löschen?`]
    if (draft.isDefaultVariant) lines.push('Sie ist die Standard-Variante: danach hat der Song keine, bis du eine andere als Standard festlegst. Setlist-Einträge ohne eigene Variante spielen bis dahin nichts.')
    if (usedIn.length > 0) lines.push(`Gewählt in ${usedIn.map((setlist) => `„${setlist.name}“`).join(', ')} - dort steht dann „Variante gelöscht“, es spielt keine andere.`)
    if (!(await confirm(lines.join('\n\n'), { title: 'Variante löschen', confirmLabel: 'Löschen', danger: true }))) return
    try {
      await deleteVariant(draft.variantId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    // Opens what's left: the default, or (none left) the first by name - see variantToOpen.
    await selectSong(draft.songId)
  }

  const handleSetDefault = async () => {
    if (dirty && !(await handleSave())) return
    const stored = songs.find((song) => song.id === draft.songId)
    if (!stored) return
    await setDefaultVariant({ ...stored, title: draft.title, artist: draft.artist }, draft.variantId)
    const next = { ...draft, isDefaultVariant: true }
    setDraft(next)
    savedDraft.current = JSON.stringify(next)
  }

  const variantActions: MenuAction[] = variantSaved
    ? [
        ...(draft.isDefaultVariant ? [] : [{ label: 'Als Standard festlegen', onClick: () => void handleSetDefault() }]),
        // The last one can't go: without any variant the song would play its old default's
        // content again (the Song mirror) - delete the song instead (Bibliothek ⋯).
        ...(variantsForSong.length > 1 ? [{ label: 'Variante löschen', danger: true, onClick: () => void handleDeleteVariant() }] : []),
      ]
    : []

  const handleSave = async (): Promise<boolean> => {
    const variant: SongVariant = {
      id: draft.variantId,
      songId: draft.songId,
      label: draft.variantLabel.trim() || 'Original',
      isDefault: draft.isDefaultVariant,
      bpm: draft.bpm,
      timeSignature: draft.timeSignature,
      clickTrackEnabled: draft.clickTrackEnabled,
      chordProContent: draft.chordProContent,
      timecodes: draft.timecodes,
      cues: draft.cues,
      ...(draft.beatGrid ? { beatGrid: draft.beatGrid } : {}),
      countInEnabled: draft.countInEnabled,
      countInBars: draft.countInBars,
      durationMs: draft.durationMs,
      tracks: currentTracks,
      key: draft.key,
      // The old text only while it can't be read - a recognised one lives on as chartTuning.
      ...(draft.tuning && !draft.chartTuning ? { tuning: draft.tuning } : {}),
      capo: draft.capo,
      ...(draft.tuningSpec ? { tuningSpec: draft.tuningSpec } : {}),
      ...(draft.chartTuning && !isStandard(draft.chartTuning) ? { chartTuning: draft.chartTuning } : {}),
      ...(draft.transpose ? { transpose: draft.transpose } : {}),
    }
    const variantResult = SongVariantSchema.safeParse(variant)
    if (!variantResult.success) {
      setError(variantResult.error.issues[0]?.message ?? 'Ungültige Eingabe')
      return false
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
      timeSignature: defaultVariant?.timeSignature ?? draft.timeSignature,
      clickTrackEnabled: defaultVariant?.clickTrackEnabled ?? draft.clickTrackEnabled,
      chordProContent: defaultVariant?.chordProContent ?? draft.chordProContent,
      timecodes: defaultVariant?.timecodes ?? draft.timecodes,
    }
    const songResult = SongSchema.safeParse(song)
    if (!songResult.success) {
      setError(songResult.error.issues[0]?.message ?? 'Ungültige Eingabe')
      return false
    }

    setError(null)
    await saveSong(songResult.data)
    await saveVariant(variantResult.data)
    savedDraft.current = JSON.stringify(draft)
    setSavedAt(Date.now())
    return true
  }
  saveRef.current = handleSave

  /** Marks the block starting at the caret as a song part by inserting a `{part: ...}` directive. */
  const insertPart = (label: string) => {
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

  /** Inserts a blank `{cc: }` comment directive at the caret's line (issue #215 follow-up) -
   * "+ Kommentar" alongside the part buttons above. Puts the caret *inside* the braces, unlike
   * insertPart's fixed labels - a comment has no label to pick, it's typed right here. Starts
   * targeted at everyone (`cc`, no name); retarget it afterward in the Kommentare tab. */
  const insertComment = () => {
    const textarea = textareaRef.current
    const content = draft.chordProContent
    const caret = textarea?.selectionStart ?? content.length
    const lineStart = content.lastIndexOf('\n', caret - 1) + 1
    const prefix = '{cc: '
    const directive = `${prefix}}\n`
    setDraft({
      ...draft,
      chordProContent: content.slice(0, lineStart) + directive + content.slice(lineStart),
    })
    requestAnimationFrame(() => {
      const caretAfter = lineStart + prefix.length
      textarea?.focus()
      textarea?.setSelectionRange(caretAfter, caretAfter)
    })
  }

  /** Inserts an empty tab block (`{start_of_tab}` ... `{end_of_tab}`) at the caret's line and
   * puts the caret on the blank line inside it, ready to paste a riff. For everyone by default;
   * narrow it to specific members afterward in the Kommentare tab's "Tab-Blöcke" list. */
  const insertTabBlock = () => {
    const textarea = textareaRef.current
    const content = draft.chordProContent
    const caret = textarea?.selectionStart ?? content.length
    const lineStart = content.lastIndexOf('\n', caret - 1) + 1
    const opening = '{start_of_tab}\n'
    const block = `${opening}\n{end_of_tab}\n`
    setDraft({
      ...draft,
      chordProContent: content.slice(0, lineStart) + block + content.slice(lineStart),
    })
    requestAnimationFrame(() => {
      const caretAfter = lineStart + opening.length
      textarea?.focus()
      textarea?.setSelectionRange(caretAfter, caretAfter)
    })
  }

  /** Ultimate Guitar's own bpm/key/tuning/capo only ever come in on top of whatever the
   * import found - a missing field there must not silently overwrite a value already in the
   * editor (e.g. a capo the previous variant had that this particular tab just doesn't list). */
  const handleImport = (imported: ImportedSongData) => {
    setDraft({
      ...draft,
      chordProContent: imported.chordProContent,
      artist: imported.artist ?? draft.artist,
      key: imported.key ?? draft.key,
      ...(imported.tuning ? tuningFromText(imported.tuning) : {}),
      capo: imported.capo ?? draft.capo,
      bpm: imported.bpm ?? draft.bpm,
    })
  }

  /** "Track analysieren": automatic beat detection on `tapTrack`'s audio, turned into a click grid
   * with as few alignment points as the detected downbeats need (beatGrid.ts `gridFromBeats`,
   * docs/14 §5a) - reviewed and corrected in the timeline, never trusted blindly. Uses the
   * `music-tempo-beat-detection` plugin (far more accurate, see musicTempoAnalysis.ts) if the band
   * has installed and enabled it (CAPABILITIES.audioAnalysis), else the built-in detector. Shared
   * with the timeline, which applies the result as an undoable step. Null: track missing on this
   * device or nothing detected. The variant's bpm follows the grid's first stretch, so the
   * count-in and every tempo display agree with what the click plays. */
  const detectGrid = async (trackId?: string): Promise<{ bpm: number; beatGrid: BeatGrid } | null> => {
    if (!tapTrack) return null
    const blob = await getTrack(draft.variantId, trackId ?? tapTrack.id)
    if (!blob) return null
    const provider = pluginProviding(installedPlugins, CAPABILITIES.audioAnalysis) ? 'music-tempo' : 'hand-rolled'
    const result = await analyzeTrackBlob(blob, draft.timeSignature, provider)
    if (result.bpm === null) return null
    const beatGrid = gridFromBeats(result.beats, result.bpm, draft.timeSignature)
    if (!beatGrid) return null
    const first = gridStretches(beatGrid, result.bpm, draft.timeSignature)[0]!
    return { bpm: Math.round(first.bpm * 10) / 10, beatGrid }
  }

  const handleAnalyzeTrack = async () => {
    if (!tapTrack) return
    // Same question as the Timeline's "Track analysieren": with stems, mix or which stem.
    const source = await askAnalysisSource(promptFields, stemsForTrack(currentTracks, tapTrack.id))
    if (source === undefined) return
    if (draft.beatGrid && !(await confirm('Vorhandenes Klick-Raster durch die automatische Erkennung ersetzen?', { confirmLabel: 'Ersetzen' }))) return
    setIsAnalyzing(true)
    setAnalyzeError(null)
    try {
      const result = await detectGrid(source ?? undefined)
      if (!result) {
        setAnalyzeError('Keine Schläge erkannt - bitte in der Timeline setzen.')
        return
      }
      setDraft((d) => (d ? { ...d, bpm: result.bpm, beatGrid: result.beatGrid } : d))
    } catch {
      setAnalyzeError('Analyse fehlgeschlagen.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  /** "Raster löschen" - back to bar 1 at 0:00 at the entered bpm. Only the draft; "Speichern"
   * makes it stick. */
  const handleClearGrid = async () => {
    if (await confirm('Klick-Raster löschen? Der Klick läuft danach ab 0:00 im eingetragenen Tempo. Erst „Speichern“ übernimmt es.', { confirmLabel: 'Löschen', danger: true })) {
      setDraft((d) => (d ? { ...d, beatGrid: undefined } : d))
    }
  }

  const preview = parseChordPro(draft.chordProContent)
  /** Tap a preview line → cursor at that line (and word) in the text (#607). No coupled scrolling. */
  const jumpToSource = (sourceLine: number, column: number) => {
    setTextExpanded(true)
    setJumpTo(sourcePosition(draft.chordProContent, sourceLine, column))
  }

  // One topic (#180 follow-up): BPM/Takt/click/count-in are the "set it and glance at it"
  // basics, and the click grid below the divider is the same topic gone deeper - its editing
  // happens in the timeline (docs/14 §5a), this shows its state and the grid-wide actions.
  // Identical content on every layout; only the framing (tab, sheet, section) differs.
  const stretches = draft.beatGrid ? gridStretches(draft.beatGrid, draft.bpm, draft.timeSignature) : []
  const gridSummary = draft.beatGrid
    ? `${draft.beatGrid.points.length} ${draft.beatGrid.points.length === 1 ? 'Ausrichtungspunkt' : 'Ausrichtungspunkte'}, Takt 1 bei ${formatTimelineTime(clickTimeline(draft).bar1Ms)} · ${
        stretches.length > 1
          ? `${Math.min(...stretches.map((s) => s.bpm)).toFixed(1)}-${Math.max(...stretches.map((s) => s.bpm)).toFixed(1)} BPM`
          : `${stretches[0]!.bpm.toFixed(1)} BPM`
      }`
    : 'Kein Raster: der Klick läuft ab 0:00 im eingetragenen Tempo.'
  const tempoContent = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          BPM
          <input
            type="number"
            className={`min-h-form px-3 ${INPUT}`}
            value={draft.bpm}
            onChange={(e) => setDraft({ ...draft, bpm: Number(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Takt
          <input
            className={`min-h-form px-3 ${INPUT}`}
            placeholder="4/4"
            value={draft.timeSignature}
            onChange={(e) => setDraft({ ...draft, timeSignature: e.target.value })}
          />
        </label>
      </div>
      <Switch
        label="Klick standardmäßig an"
        description="Per Show überstimmbar."
        checked={draft.clickTrackEnabled}
        onChange={(clickTrackEnabled) => setDraft({ ...draft, clickTrackEnabled })}
      />
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Switch label="Count-in" checked={draft.countInEnabled} onChange={(countInEnabled) => setDraft({ ...draft, countInEnabled })} />
        </div>
        <label className="flex items-center gap-1 text-sm text-ink-muted">
          Takte
          <input
            type="number"
            min={1}
            disabled={!draft.countInEnabled}
            className={`w-16 min-h-form px-3 ${INPUT_FREE}`}
            value={draft.countInBars}
            onChange={(e) => setDraft({ ...draft, countInBars: Math.max(1, Number(e.target.value)) })}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <span className="text-sm text-ink-muted">Klick-Raster</span>
        <p className="text-sm text-ink-soft">{gridSummary}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditorView('timeline')}>
            In der Timeline bearbeiten
          </Button>
          <Button onClick={() => void handleAnalyzeTrack()} disabled={!tapTrack || isAnalyzing}>
            {isAnalyzing ? 'Analysiere…' : 'Track analysieren'}
          </Button>
          <Button variant="danger" onClick={() => void handleClearGrid()} disabled={!draft.beatGrid}>
            Raster löschen
          </Button>
        </div>
        {analyzeError && <p className="text-sm text-danger">{analyzeError}</p>}
      </div>
    </div>
  )

  // Cues live only in the timeline (#602) - placed over the waveform, with the guided CueDialog
  // and the recorder; the old list with raw JSON is gone.
  // With a track attached, its length *is* the song's length (read-only, measured from the file);
  // the hand-entered one only exists for songs without a track - e.g. click-only playback (#28).
  const playingTrack = currentTracks.find((t) => t.kind === 'band-mix') ?? playableTracks(currentTracks)[0]
  const audioContent = (
    <div className="flex flex-col gap-3">
      {playingTrack ? (
        <div className="flex flex-col gap-1 text-sm text-ink-muted">
          Dauer
          <span className="flex h-form w-40 items-center rounded-control bg-control px-3 text-ink">
            {playingTrack.durationMs === undefined
              ? 'wird gemessen…'
              : `${Math.round(playingTrack.durationMs / 1000)} s`}
          </span>
          <span className="text-xs text-ink-faint">
            Länge des Tracks - wird automatisch gemessen und kann nicht geändert werden.
          </span>
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Dauer (Sekunden)
          <input
            type="number"
            min={1}
            value={draft.durationMs === undefined ? '' : Math.round(draft.durationMs / 1000)}
            onChange={(e) => {
              const seconds = Math.round(Number(e.target.value))
              setDraft({ ...draft, durationMs: e.target.value === '' || !(seconds > 0) ? undefined : seconds * 1000 })
            }}
            className={`h-form w-40 px-3 ${INPUT_FREE}`}
          />
          <span className="text-xs text-ink-faint">
            Ohne Track: die Länge für Festival-Uhr und automatisches Stoppen (auch bei reinem Klick). Leer = geschätzt
            (Standard 4 min), kein automatisches Stoppen.
          </span>
        </label>
      )}
      <TrackManagerField
        variantId={draft.variantId}
        tracks={currentTracks}
        // True only for a variant that exists in this draft but not yet in the store - i.e. a
        // fresh "+ Neue Variante" click that hasn't been saved yet, not "this song is new" (that
        // state no longer exists here at all - see the props/selectSong doc comments above).
        disabled={!variantsForSong.some((v) => v.id === draft.variantId)}
      />
    </div>
  )

  const commentsContent = (
    <CommentListEditor
      content={draft.chordProContent}
      onChange={(chordProContent) => setDraft({ ...draft, chordProContent })}
    />
  )

  // `fullLabel` names each accordion header (#603: the same on every screen).
  // Timeline (docs/14, phase 1): the grid over the track's waveform, editable - on the same draft.
  const timelineContent = (
    <TimelineEditor
      variantId={draft.variantId}
      trackId={tapTrack?.id ?? null}
      trackSrc={tapTrackSrc}
      beatGrid={draft.beatGrid}
      bpm={draft.bpm}
      timeSignature={draft.timeSignature}
      countInEnabled={draft.countInEnabled}
      countInBars={draft.countInBars}
      content={draft.chordProContent}
      cues={draft.cues}
      onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
      onDetectGrid={detectGrid}
      fill
      startLineTapping={tapLinesOnOpen}
      onLineTappingStarted={() => setTapLinesOnOpen(false)}
    />
  )

  // Switching the editor's page = underline tabs (docs/15), like System and the phone tabs below.
  const viewSwitch = (
    <Tabs
      label="Ansicht"
      value={editorView}
      onChange={setEditorView}
      tabs={[
        { value: 'text', label: 'Text', icon: 'text' },
        { value: 'timeline', label: 'Timeline', icon: 'timeline' },
      ]}
    />
  )

  const detailSections = [
    {
      key: 'tempo' as const,
      fullLabel: 'Tempo & Klick',
      content: tempoContent,
      expanded: tempoExpanded,
      onToggleExpand: () => setTempoExpanded((v) => !v),
    },
    {
      key: 'audio' as const,
      fullLabel: 'Audio',
      content: audioContent,
      expanded: audioExpanded,
      onToggleExpand: () => setAudioExpanded((v) => !v),
    },
    {
      key: 'comments' as const,
      fullLabel: 'Kommentare',
      content: commentsContent,
      expanded: commentsExpanded,
      onToggleExpand: () => setCommentsExpanded((v) => !v),
    },
  ]

  // The ChordPro editor itself - still the most commonly needed section by default (see
  // `textExpanded` above), but now genuinely its own collapsible section like everything else,
  // not the one thing permanently pinned open. Title/Band moved out to the always-visible
  // header above (see the JSX below) - unlike the chords, they're glanced at for context
  // regardless of which section is open, not "the thing you're actively editing".
  const textContent = (
    <div className="flex flex-1 flex-col gap-3">
      <label className="flex flex-1 flex-col gap-1 text-sm text-ink-muted">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="max-[599px]:w-full">ChordPro-Text</span>
          <span className="flex gap-1">
            <Button onClick={() => setIsImporting(true)}>
              Song importieren
            </Button>
            <Button onClick={() => {
                setTapLinesOnOpen(true)
                setEditorView('timeline')
              }} disabled={!draft.chordProContent.trim()}>
              Tap-to-Sync starten
            </Button>
          </span>
        </div>
        {/* Phone: one "+ Einfügen" instead of six buttons in three rows (2026-10-16). */}
        <Button className="self-start min-[600px]:hidden" onClick={() => setInsertMenuOpen(true)}>
          + Einfügen
        </Button>
        {insertMenuOpen && (
          <ActionMenuDialog
            title="Einfügen"
            actions={[
              ...PART_LABELS.map((label) => ({ label: `+ ${label}`, onClick: () => insertPart(label) })),
              { label: '+ Kommentar', onClick: insertComment },
              { label: '+ Tab', onClick: insertTabBlock },
            ]}
            onClose={() => setInsertMenuOpen(false)}
          />
        )}
        <div className="flex flex-wrap gap-1 max-[599px]:hidden">
          {PART_LABELS.map((label) => (
            <Button className="uppercase tracking-wide" key={label} onClick={() => insertPart(label)}>
              + {label}
            </Button>
          ))}
          <Button className="uppercase tracking-wide" onClick={insertComment}>
            + Kommentar
          </Button>
          <Button className="uppercase tracking-wide" onClick={insertTabBlock}>
            + Tab
          </Button>
        </div>
        <textarea
          ref={textareaRef}
          className={`min-h-[240px] flex-1 min-w-0 p-2 font-sb-mono text-base ${INPUT_FREE}`}
          value={draft.chordProContent}
          onChange={(e) => setDraft({ ...draft, chordProContent: e.target.value })}
          placeholder="[00:00.00] Come on baby [G] don't you wanna go"
        />
      </label>
      {layout !== 'panel' && (
        <div className="rounded-container border border-line bg-surface p-4 shadow-sb">
          <ChordProLyrics lines={preview} onSourceTap={jumpToSource} />
        </div>
      )}
    </div>
  )

  // Text and the detail sections are the same accordions on every screen (#603).
  const sections = [
    {
      key: 'text' as const,
      fullLabel: 'Text',
      content: textContent,
      expanded: textExpanded,
      onToggleExpand: () => setTextExpanded((v) => !v),
    },
    ...detailSections,
  ]

  // Speichern lives in the page header, top right, and never scrolls away (#603, docs/15 D11) -
  // the same row in the text and the timeline view. Leaving goes through ← / Back, which asks
  // about unsaved changes (lib/unsavedChanges).
  const pageHeader = (
    <div className="flex items-center gap-2">
      {/* Phone: icons instead of words so the song being edited still fits - the status bar shows
          the queue's song, not this one (#603). From 600 px the words come back. */}
      <Button aria-label="Bibliothek" title="Bibliothek" className="max-[599px]:px-3" onClick={() => void leave()}>
        <Icon name="back" />
        <span className="max-[599px]:hidden">Bibliothek</span>
      </Button>
      {viewSwitch}
      {/* The song's name is up in the status bar while the editor is open (useEditingTitleStore). */}
      <span className="flex-1" />
      {savedAt && <span className="text-sm text-ink-faint max-[599px]:hidden">Gespeichert.</span>}
      <Button variant="primary" aria-label="Speichern" title="Speichern" className="max-[599px]:px-3" onClick={() => void handleSave()}>
        <Icon name="save" size="1.4em" className="min-[600px]:hidden" />
        <span className="max-[599px]:hidden">Speichern</span>
      </Button>
    </div>
  )

  if (editorView === 'timeline') {
    return (
      <div className="flex h-full flex-col gap-2 sb-app-bg p-3 text-ink">
        {pageHeader}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="min-h-0 flex-1">{timelineContent}</div>
      </div>
    )
  }

  const isPanel = layout === 'panel'
  const showMeta = metaOpen ?? (isPanel || !draft.title.trim())
  const metaTuning = stageTuning(draft)
  const metaSummary = [
    draft.title.trim() || '(ohne Titel)',
    draft.artist,
    draft.key && `Key ${soundingKey(draft)}`,
    (draft.transpose ?? 0) !== 0 && `Transponiert ${signedSteps(draft.transpose ?? 0)}`,
    !isStandard(metaTuning) && tuningLabel(metaTuning),
    draft.capo !== undefined && `Capo ${draft.capo}`,
    `${draft.bpm} BPM`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  return (
    <div className="flex h-full flex-col gap-2 sb-app-bg p-3 text-ink">
      {pageHeader}
      {error && <p className="text-sm text-danger">{error}</p>}
      {/* Landscape/desktop: two columns that scroll each on their own; phone/tablet portrait:
          one column that scrolls as a whole, under the fixed header. */}
      <div className={`min-h-0 flex-1 gap-3 ${isPanel ? 'grid grid-cols-2' : 'flex flex-col overflow-y-auto'}`}>
      <div className={`flex flex-col gap-3 rounded-container border border-line bg-surface p-4 shadow-sb ${isPanel ? 'overflow-y-auto' : ''}`}>
        {/* Switching to a different song, creating a new one, and deleting this one all moved
            to LibraryView's own tree (its "+ Neu" and each row's ⋯ menu) - going back there is
            how you pick a different song now, not a dropdown duplicating the same list. */}
        <label className="flex min-w-0 flex-col gap-1 text-sm text-ink-muted">
          Variante
          {/* min-w-0: a long variant name ("Auto: Hand-rolled (FFT/Spectral-Flux)…") made the
              select push the whole form past the right edge on a phone (#373). */}
          {/* Phone: the select on its own line - beside "+ Neue Variante" it shrank to "Ori" (#603). */}
          <div className="flex min-w-0 items-center gap-2 max-[599px]:flex-wrap [&>select]:min-w-0">
            <select
              className={`min-h-form px-3 text-base flex-1 min-w-0 max-[599px]:basis-full ${INPUT}`}
              value={draft.variantId}
              onChange={(e) => selectVariant(e.target.value)}
            >
              {!variantsForSong.some((v) => v.id === draft.variantId) && (
                <option value={draft.variantId}>{draft.variantLabel} (neu)</option>
              )}
              {variantsForSong.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.isDefault ? `${variant.label} (Standard)` : variant.label}
                </option>
              ))}
            </select>
              <AddRow inline label="Neue Variante" onClick={addVariant} />
              {variantActions.length > 0 && <ActionMenu title={`Variante „${draft.variantLabel}“`} actions={variantActions} />}
            </div>
          </label>
        {!hasDefault && variantsForSong.length > 0 && (
          <p role="alert" className="rounded-control border border-warn/60 bg-warn/20 px-3 py-2 text-base text-ink">
            Dieser Song hat keine Standard-Variante. Setlist-Einträge ohne eigene Variante spielen nichts, bis du
            eine Variante als Standard festlegst (⋯ neben der Variante).
          </p>
        )}
        {!draft.isDefaultVariant && (
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Varianten-Name
            <input
              className={`min-h-form px-3 ${INPUT}`}
              value={draft.variantLabel}
              onChange={(e) => setDraft({ ...draft, variantLabel: e.target.value })}
            />
          </label>
        )}

        {/* "Which song is this, and how do I play it" - one summary line until opened (#603: on
            the phone the fields filled the whole screen before the text). */}
        <button
          type="button"
          onClick={() => setMetaOpen(!showMeta)}
          aria-expanded={showMeta}
          aria-label="Song-Angaben"
          className="flex min-h-form w-full min-w-0 items-center gap-2 rounded-control bg-control px-3 text-left text-base text-ink [@media(hover:hover)]:hover:bg-control-hover"
        >
          <Icon name={showMeta ? 'collapse' : 'expand'} />
          <span className="min-w-0 flex-1 truncate">{metaSummary}</span>
        </button>
        {showMeta && (
          <>
            <div className="flex gap-2 max-[599px]:flex-col">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-ink-muted">
                Titel
                <input
                  className={`min-h-form px-3 ${INPUT}`}
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-ink-muted">
                Band
                <input
                  className={`min-h-form px-3 ${INPUT}`}
                  value={draft.artist ?? ''}
                  onChange={(e) => setDraft({ ...draft, artist: e.target.value || undefined })}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 [&>label]:min-w-0">
              <label className="flex flex-col gap-1 text-sm text-ink-muted">
                Key
                <input
                  className={`min-h-form px-3 ${INPUT}`}
                  value={draft.key ?? ''}
                  onChange={(e) => setDraft({ ...draft, key: e.target.value || undefined })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-muted">
                Capo
                <input
                  type="number"
                  min={0}
                  className={`min-h-form px-3 ${INPUT}`}
                  value={draft.capo ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, capo: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </label>
            </div>
            {/* Band-wide for this variant (Marco, 2026-10-18): how it sounds against the original, how
                the band tunes for it, and what the chart is written for - the chords on stage follow
                from all three (lib/pitch.ts). Guided pickers, no free text. */}
            <div className="grid grid-cols-[2fr_1fr] gap-2 max-[599px]:grid-cols-1 [&>*]:min-w-0">
              <KeyTuningField value={draft} onChange={(next) => setDraft({ ...draft, ...next })} />
              <TuningSelect
                label="Akkorde notiert für"
                value={draft.chartTuning}
                onChange={(chartTuning) => setDraft({ ...draft, chartTuning, tuning: undefined })}
              />
            </div>
            {variantChordShift(draft) !== 0 && (
              <p className="text-sm text-ink-faint">
                Auf der Bühne stehen die Akkorde verschoben (siehe Tonart &amp; Stimmung) - hier im Text bleiben sie wie
                geschrieben.
              </p>
            )}
          </>
        )}
        {draft.tuning && !draft.chartTuning && (
          <p role="alert" className="rounded-control border border-warn/60 bg-warn/20 px-3 py-2 text-base text-ink">
            Unbekannte Stimmung „{draft.tuning}“ (alter Freitext) - bitte unter „Akkorde notiert für“ wählen.
          </p>
        )}

        {/* Every section an independently-collapsible accordion, on every screen (#180, #603 -
            the portrait tab strip ran off the phone). All start collapsed (Marco). */}
        {sections.map((section) => (
          <div key={section.key} className="flex flex-col gap-3 border-t border-line pt-3">
            <button
              type="button"
              onClick={section.onToggleExpand}
              aria-expanded={section.expanded}
              className="flex min-h-form items-center gap-2 self-start text-base font-medium text-ink-soft [@media(hover:hover)]:hover:text-ink"
            >
              <Icon name={section.expanded ? 'collapse' : 'expand'} /> {section.fullLabel}
            </button>
            {section.expanded && section.content}
          </div>
        ))}
      </div>
      {/* Its own grid column only in 'panel' layout - otherwise the preview already renders
          inline at the end of `textContent`, right below the textarea. */}
      {isPanel && (
        <div className="overflow-y-auto rounded-container border border-line bg-surface p-6 shadow-sb">
          <ChordProLyrics lines={preview} onSourceTap={jumpToSource} />
        </div>
      )}
      </div>
      {isImporting && (
        <TabImportOverlay
          onImport={handleImport}
          onClose={() => setIsImporting(false)}
          initialQuery={[draft.title, draft.artist ?? ''].filter((part) => part.trim()).join(' ')}
        />
      )}
    </div>
  )
}
