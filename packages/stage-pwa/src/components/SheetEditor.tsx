import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SongSchema,
  SongVariantSchema,
  CAPABILITIES,
  isSongEntry,
  mergeChordLines,
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
import { parseChordPro, songChords, sourcePosition } from '../lib/chordpro'
import { bracketProblems, transposeText } from '../lib/textTools'
import { CleanupDialog } from './CleanupDialog'
import { EditorBackdrop, type BackdropMark } from './EditorBackdrop'
import { FindReplaceBar, type FindMemory } from './FindReplaceBar'
import type { TextMatch } from '../lib/textReplace'
import { randomId } from '../lib/id'
import { applyCueAnchors } from '../lib/cueAnchors'
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
import { CHORDPRO_KEYS, ChordProKeyBar } from './ChordProKeyBar'
import { CRAMPED_TYPING_PX, useSettledTouchKeyboardOpen } from '../lib/useTouchKeyboardOpen'
import { useSettledVisualViewport } from '../lib/useVisualViewport'
import { CommentListEditor } from './CommentListEditor'
import { InsertCommentDialog, InsertTabDialog } from './InsertNoteDialogs'
import { TextFixDialog, type TextFixPick } from './TextFixDialog'
import { applyTextFixes, textFixOffers, type TextFixOffer } from '../lib/variantTextFix'
import { TabImportOverlay, type ImportedSongData } from './TabImportOverlay'
import { TrackManagerField } from './TrackManagerField'
import { TimelineEditor } from './timeline/TimelineEditor'
import { useBackHandler } from '../lib/backNavigation'
import { confirmLeave, useUnsavedChangesGuard } from '../lib/unsavedChanges'
import { Icon } from './Icon'
import { ActionMenu, AddRow, ActionMenuDialog, IconButton, menuIcon, Switch, Tabs, Button, type MenuAction } from './ui'
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
type EditorView = 'text' | 'preview' | 'timeline' | 'details'

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

/** Visible height (keyboard up) from which the variant row stays above the text while typing. */
export const ROOMY_FOR_VARIANT_ROW_PX = 600


/** How long the "Im Hochformat ist mehr Platz" hint stays. */
const PORTRAIT_HINT_MS = 4000

/** Visible height below which the editor's page header steps aside while the keyboard is up. */
export const ROOMY_FOR_HEADER_PX = 400

/** Visible height from which the search bar shows all its rows (a tablet in portrait without the keyboard). */
export const ROOMY_FOR_FULL_SEARCH_PX = 760

/** Whether the song text shows its invisible characters (· → ¶) - per device. */
const INVISIBLES_KEY = 'sb:editor-invisibles'

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
  // Song-Angaben in Details (#617): open for a song without a title (a new one), closed otherwise.
  const [metaOpen, setMetaOpen] = useState<boolean | null>(null)
  // A tapped preview line's position in the text (#607) - applied once the text field is there,
  // since the Text view may first have to open.
  const [jumpTo, setJumpTo] = useState<number | null>(null)
  // The text field has the focus - shows the ChordPro keys above the phone keyboard (#606) and,
  // on the phone, leaves the screen to the text alone (#617).
  const [textFocused, setTextFocused] = useState(false)
  // From where the focus really is: a field that is rebuilt while focused never sends its blur, and
  // the ChordPro key bar then stayed for the search field (Redmi, landscape, 2026-10-29).
  // "Im Hochformat ist mehr Platz" - once per editor session, for a few seconds (see crampedOnPhone).
  const [portraitHint, setPortraitHint] = useState(false)
  const portraitHintShown = useRef(false)
  useEffect(() => {
    if (!portraitHint) return
    const id = setTimeout(() => setPortraitHint(false), PORTRAIT_HINT_MS)
    return () => clearTimeout(id)
  }, [portraitHint])
  useEffect(() => {
    const follow = (e: FocusEvent) => setTextFocused(e.target === textareaRef.current)
    document.addEventListener('focusin', follow)
    return () => document.removeEventListener('focusin', follow)
  }, [])
  // Where the cursor is in the text: the preview follows it (#617).
  const [caret, setCaret] = useState(0)
  // Every section starts collapsed (Marco, explicit request).
  const [tempoExpanded, setTempoExpanded] = useState(false)
  const [audioExpanded, setAudioExpanded] = useState(false)
  const [commentsExpanded, setCommentsExpanded] = useState(false)
  const [pageMenuOpen, setPageMenuOpen] = useState(false)
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false)
  // Aufräumen / Suchen & Ersetzen open on the range they were started on (#605, 2026-10-29).
  const [toolDialog, setToolDialog] = useState<{ kind: 'cleanup'; start: number; end: number; scope: string } | null>(null)
  // Suchen & Ersetzen as a bar over the text, like Notepad++ (2026-10-29): open with the lines
  // marked at that moment (or none), its matches drawn on the layer behind the text.
  const [findBar, setFindBar] = useState<{ range: { start: number; end: number } | null } | null>(null)
  const findMemory = useRef<FindMemory>({})
  const [findMarks, setFindMarks] = useState<{ marks: BackdropMark[]; current: TextMatch | null }>({ marks: [], current: null })
  const onFindMarks = useCallback((marks: BackdropMark[], current: TextMatch | null) => setFindMarks({ marks, current }), [])
  // The current search match in view: scrolled to a third of the field's height, the text cursor
  // set on it (without focusing - no keyboard pops up).
  useEffect(() => {
    const match = findMarks.current
    const textarea = textareaRef.current
    if (!match || !textarea) return
    const mark = textarea.parentElement?.querySelector<HTMLElement>('[data-testid="editor-backdrop"] [data-current]')
    if (mark) {
      textarea.scrollTop = Math.max(0, mark.offsetTop - textarea.clientHeight / 3)
      const layer = mark.closest<HTMLElement>('[data-testid="editor-backdrop"]')
      if (layer) layer.scrollTop = textarea.scrollTop
    }
    textarea.setSelectionRange(match.start, match.end)
  }, [findMarks])
  // Invisible characters (· → ¶) on the layer behind the text - remembered on this device.
  const [showInvisibles, setShowInvisibles] = useState(() => {
    try {
      return localStorage.getItem(INVISIBLES_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleInvisibles = () =>
    setShowInvisibles((on) => {
      try {
        localStorage.setItem(INVISIBLES_KEY, on ? '0' : '1')
      } catch {
        // blocked storage: only for this session
      }
      return !on
    })
  // The text before the last text tool ran (#605) - "Rückgängig" until the next edit by hand.
  const [toolUndo, setToolUndo] = useState<{ before: string; label: string } | null>(null)
  // "+ Kommentar" / "+ Tab" dialogs (#608).
  const [noteDialog, setNoteDialog] = useState<'comment' | 'tab' | null>(null)
  // On save: the changed lines other variants still have (#600) - answered with the picks, or null for "Abbrechen".
  const [textFix, setTextFix] = useState<{ offers: TextFixOffer[]; resolve: (picks: TextFixPick[] | null) => void } | null>(null)
  // The text as it was a moment ago - the bracket hint follows it, not every keystroke (#605:
  // must not slow typing on a phone, and a "[Am" being typed is not a mistake yet).
  const [settledText, setSettledText] = useState('')
  // Views of the same draft in the header (#617): the text, its preview (phone - on wide screens
  // it stands beside the text), the full-screen timeline (docs/14) and the song's details.
  const [editorView, setEditorView] = useState<EditorView>('text')
  // On a wide screen the preview has no view of its own - it stands beside the text.
  const view: EditorView = editorView === 'preview' && layout === 'panel' ? 'text' : editorView
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
    setCaret(jumpTo)
  }, [jumpTo, view])

  // The cursor's line, scrolled into the preview's view (#617) - inside the preview's own scroll
  // box, never the page. Marked there through `activeIndex`.
  const previewRef = useRef<HTMLDivElement>(null)
  const keyboardOpen = useSettledTouchKeyboardOpen()
  const visible = useSettledVisualViewport()
  const content = draft?.chordProContent ?? ''
  useEffect(() => {
    const timer = setTimeout(() => setSettledText(content), 800)
    return () => clearTimeout(timer)
  }, [content])
  useEffect(() => {
    const box = previewRef.current
    if (!box) return
    const line = box.querySelector<HTMLElement>('[data-active-line="true"]')
    if (!line) return
    const top = line.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    box.scrollTo?.({ top: Math.max(0, top - box.clientHeight / 3) })
  }, [caret, view, content])

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
    const timelineOpen = view === 'timeline'
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
  }, [view, draft?.variantId, tapTrack?.id])

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
  // Back closes the current view: every other view returns to the text, the text to the library.
  useBackHandler(view !== 'text' ? () => setEditorView('text') : () => void leave())

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
      // Anchored cues at their bar and beat, also after a tempo change in the details (#483).
      cues: applyCueAnchors(draft.cues, clickTimeline({ beatGrid: draft.beatGrid, bpm: draft.bpm, timeSignature: draft.timeSignature })),
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

    // The same text fix for the other variants (#600): offered line by line, each variant's own
    // timing tags stay. "Abbrechen" there means nothing is saved.
    const others = variantsForSong.filter((v) => v.id !== variant.id)
    const stored = variantsForSong.find((v) => v.id === variant.id)
    const offers = stored ? textFixOffers(stored.chordProContent, variant.chordProContent, others) : []
    let fixed: SongVariant[] = []
    if (offers.length > 0) {
      const picks = await new Promise<TextFixPick[] | null>((resolve) =>
        setTextFix({
          offers,
          resolve: (answer) => {
            setTextFix(null)
            resolve(answer)
          },
        }),
      )
      if (picks === null) return false
      fixed = others.flatMap((other) => {
        const fixes = picks.flatMap(({ offer, target }) => {
          const place = offers[offer].targets[target]
          return place.variantId === other.id ? [{ lineIndex: place.lineIndex, after: offers[offer].after }] : []
        })
        return fixes.length > 0 ? [{ ...other, chordProContent: applyTextFixes(other.chordProContent, fixes) }] : []
      })
    }
    // A fixed default variant carries its new text into the Song mirror too.
    const fixedDefault = fixed.find((v) => v.isDefault)
    const songToSave = fixedDefault ? { ...songResult.data, chordProContent: fixedDefault.chordProContent } : songResult.data

    setError(null)
    await saveSong(songToSave)
    await saveVariant(variantResult.data)
    for (const other of fixed) await saveVariant(other)
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

  /** Replaces the selection (or inserts at the caret) with `before` + selection + `after` and puts
   * the caret after it - the ChordPro keys and chord buttons (#606). The field keeps the focus. */
  const typeAtCaret = (before: string, after = '', keepSelection = false) => {
    const textarea = textareaRef.current
    const content = draft.chordProContent
    const start = textarea?.selectionStart ?? content.length
    const end = textarea?.selectionEnd ?? start
    const selected = keepSelection ? content.slice(start, end) : ''
    const inserted = before + selected + after
    setDraft({ ...draft, chordProContent: content.slice(0, start) + inserted + content.slice(end) })
    requestAnimationFrame(() => {
      const caretAfter = start + inserted.length
      textarea?.focus()
      textarea?.setSelectionRange(caretAfter, caretAfter)
    })
  }

  /** `[` with text selected wraps it as a chord - "Am" → "[Am]" (#606), from the key bar or the
   * keyboard; the other keys just type. */
  const typeChordProKey = (key: (typeof CHORDPRO_KEYS)[number]) => {
    const textarea = textareaRef.current
    const hasSelection = textarea !== null && textarea.selectionStart !== textarea.selectionEnd
    if (key === '[' && hasSelection) typeAtCaret('[', ']', true)
    else typeAtCaret(key)
  }

  /** "+ Kommentar" / "+ Tab" (#608) open a dialog - text, template and "Sichtbar für" - which hands
   * back finished ChordPro lines; they go in above the caret's line, the caret after them. */
  const insertLinesAtCaret = (lines: string) => {
    const textarea = textareaRef.current
    const content = draft.chordProContent
    const caret = textarea?.selectionStart ?? content.length
    const lineStart = content.lastIndexOf('\n', caret - 1) + 1
    const block = `${lines}\n`
    setDraft({ ...draft, chordProContent: content.slice(0, lineStart) + block + content.slice(lineStart) })
    requestAnimationFrame(() => {
      const caretAfter = lineStart + block.length
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
    setEditorView('text')
    setJumpTo(sourcePosition(draft.chordProContent, sourceLine, column))
  }
  // The preview line the cursor is in: the last one starting at or before the cursor's line (#617)
  // - or the first one, while the cursor is still above it (a `{part:}` line).
  const caretLine = draft.chordProContent.slice(0, caret).split('\n').length - 1
  const caretIndex = Math.max(0, preview.reduce((found, line, index) => ((line.sourceLine ?? 0) <= caretLine ? index : found), -1))

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
        {/* The main way into the grid, the rest behind ⋯ (#604) - one row on the phone. */}
        <div className="flex items-center gap-2">
          <Button onClick={() => setEditorView('timeline')}>In der Timeline bearbeiten</Button>
          <ActionMenu
            title="Klick-Raster"
            actions={[
              { label: isAnalyzing ? 'Analysiere…' : 'Track analysieren', disabled: !tapTrack || isAnalyzing, onClick: () => void handleAnalyzeTrack() },
              { label: 'Raster löschen', danger: true, disabled: !draft.beatGrid, onClick: () => void handleClearGrid() },
            ]}
          />
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
        searchQuery={[draft.title, draft.artist ?? ''].filter((part) => part.trim()).join(' ')}
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

  const isPanel = layout === 'panel'
  // Views in the header (#617) - icons on the phone, words from 600 px (ui/Tabs). Vorschau only
  // where it has no column of its own.
  const viewSwitch = (
    <Tabs
      label="Ansicht"
      value={view}
      onChange={setEditorView}
      tabs={[
        { value: 'text' as const, label: 'Text', icon: 'text' as const },
        ...(isPanel ? [] : [{ value: 'preview' as const, label: 'Vorschau', icon: 'eye' as const }]),
        { value: 'timeline' as const, label: 'Timeline', icon: 'timeline' as const },
        { value: 'details' as const, label: 'Details', icon: 'details' as const },
      ]}
    />
  )

  /** What a text tool works on (#605): the selected lines, or the whole text without a selection. */
  const toolRange = () => {
    const textarea = textareaRef.current
    const before = draft.chordProContent
    let start = textarea?.selectionStart ?? 0
    let end = textarea?.selectionEnd ?? 0
    if (start === end) return { start: 0, end: before.length, scope: 'der ganze Text' }
    // Whole lines: a chord line and its lyric belong together.
    start = before.lastIndexOf('\n', start - 1) + 1
    const lineEnd = before.indexOf('\n', end)
    end = lineEnd === -1 ? before.length : lineEnd
    const lines = before.slice(start, end).split('\n').length
    return { start, end, scope: `die markierten Zeilen (${lines})` }
  }

  /** Runs a text tool on the selected lines, or on the whole text without a selection (#605). */
  const applyTextTool = (label: string, tool: (text: string) => string, range = toolRange()) => {
    const before = draft.chordProContent
    const { start, end } = range
    const after = before.slice(0, start) + tool(before.slice(start, end)) + before.slice(end)
    if (after === before) {
      setToolUndo(null)
      setError(`${label}: nichts zu ändern.`)
      return
    }
    setError(null)
    setDraft({ ...draft, chordProContent: after })
    setToolUndo({ before, label })
  }

  const askTranspose = async () => {
    const result = await promptFields('Text transponieren', [{ key: 'steps', label: 'Halbtöne (z. B. 2 oder -3)', defaultValue: '2' }], 'Transponieren')
    const steps = Number(result?.steps?.replace(',', '.').trim())
    if (!result || !Number.isInteger(steps) || steps === 0 || Math.abs(steps) > 11) return
    applyTextTool(`Transponiert ${signedSteps(steps)}`, (text) => transposeText(text, steps, draft.key))
  }

  // In the text itself (#605) - for imported or pasted charts; the variant's own transpose stays
  // in Song-Angaben.
  const toolActions: MenuAction[] = [
    { label: 'Transponieren …', onClick: () => void askTranspose() },
    { label: 'Akkordzeilen integrieren', onClick: () => applyTextTool('Akkordzeilen integriert', mergeChordLines) },
    { label: 'Aufräumen …', onClick: () => setToolDialog({ kind: 'cleanup', ...toolRange() }) },
    {
      label: 'Suchen & Ersetzen …',
      onClick: () => {
        const range = toolRange()
        setFindBar({ range: range.start === 0 && range.end === draft.chordProContent.length ? null : { start: range.start, end: range.end } })
      },
    },
  ]

  const insertActions: MenuAction[] = [
    ...PART_LABELS.map((label) => ({ label: `+ ${label}`, onClick: () => insertPart(label) })),
    { label: '+ Kommentar', onClick: () => setNoteDialog('comment') },
    { label: '+ Tab', onClick: () => setNoteDialog('tab') },
  ]
  // The page's own actions behind ⋮ (docs/15 D9, #617) - out of the way of the text.
  const pageActions: MenuAction[] = [
    { label: 'Einfügen …', onClick: () => setInsertMenuOpen(true) },
    { label: 'Textwerkzeuge …', onClick: () => setToolsMenuOpen(true) },
    { label: showInvisibles ? 'Unsichtbare Zeichen ausblenden' : 'Unsichtbare Zeichen einblenden (¶)', onClick: toggleInvisibles },
    { label: 'Song importieren', onClick: () => setIsImporting(true) },
    {
      label: 'Tap-to-Sync starten',
      disabled: !draft.chordProContent.trim(),
      onClick: () => {
        setTapLinesOnOpen(true)
        setEditorView('timeline')
      },
    },
  ]

  const isStandardTuning = isStandard(stageTuning(draft))
  const showMeta = metaOpen ?? !draft.title.trim()
  const metaSummary = [
    draft.title.trim() || '(ohne Titel)',
    draft.artist,
    draft.key && `Key ${soundingKey(draft)}`,
    (draft.transpose ?? 0) !== 0 && `Transponiert ${signedSteps(draft.transpose ?? 0)}`,
    !isStandardTuning && tuningLabel(stageTuning(draft)),
    draft.capo !== undefined && `Capo ${draft.capo}`,
    `${draft.bpm} BPM`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  // "Which song is this, and how do I play it" (#603) - the first section of Details (#617).
  const metaContent = (
    <div className="flex flex-col gap-3">
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
      <div className="flex gap-2 max-[599px]:flex-col">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-ink-muted">
          Titel
          <input className={`min-h-form px-3 ${INPUT}`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
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
            onChange={(e) => setDraft({ ...draft, capo: e.target.value === '' ? undefined : Number(e.target.value) })}
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
          Auf der Bühne stehen die Akkorde verschoben (siehe Tonart &amp; Stimmung) - hier im Text bleiben sie wie geschrieben.
        </p>
      )}
    </div>
  )

  const detailSections = [
    {
      key: 'meta' as const,
      label: 'Song-Angaben',
      // Closed it still says which song and how it is played.
      summary: metaSummary,
      content: metaContent,
      expanded: showMeta,
      onToggleExpand: () => setMetaOpen(!showMeta),
    },
    {
      key: 'tempo' as const,
      label: 'Tempo & Klick',
      summary: null,
      content: tempoContent,
      expanded: tempoExpanded,
      onToggleExpand: () => setTempoExpanded((v) => !v),
    },
    {
      key: 'audio' as const,
      label: 'Audio',
      summary: null,
      content: audioContent,
      expanded: audioExpanded,
      onToggleExpand: () => setAudioExpanded((v) => !v),
    },
    {
      key: 'comments' as const,
      label: 'Kommentare',
      summary: null,
      content: commentsContent,
      expanded: commentsExpanded,
      onToggleExpand: () => setCommentsExpanded((v) => !v),
    },
  ]

  const detailsView = (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-container border border-line bg-surface p-4 shadow-sb">
      {draft.tuning && !draft.chartTuning && (
        <p role="alert" className="rounded-control border border-warn/60 bg-warn/20 px-3 py-2 text-base text-ink">
          Unbekannte Stimmung „{draft.tuning}“ (alter Freitext) - bitte unter „Akkorde notiert für“ wählen.
        </p>
      )}
      {detailSections.map((section, index) => (
        <div key={section.key} className={`flex flex-col gap-3 ${index > 0 ? 'border-t border-line pt-3' : ''}`}>
          <button
            type="button"
            onClick={section.onToggleExpand}
            aria-expanded={section.expanded}
            aria-label={section.label}
            className="flex min-h-form w-full min-w-0 items-center gap-2 text-left text-base font-medium text-ink-soft [@media(hover:hover)]:hover:text-ink"
          >
            <Icon name={section.expanded ? 'collapse' : 'expand'} />
            <span className="flex-none">{section.label}</span>
            {section.summary && !section.expanded && (
              <span className="min-w-0 flex-1 truncate font-normal text-ink-faint">{section.summary}</span>
            )}
          </button>
          {section.expanded && section.content}
        </div>
      ))}
    </div>
  )

  // One compact row (#617): the select, and everything about variants behind its ⋯ - "Neue
  // Variante" included.
  const variantRow = (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {/* min-w-0: a long variant name made the select push the form past the right edge (#373). */}
        <select
          aria-label="Variante"
          className={`min-h-form flex-1 min-w-0 px-3 text-base ${INPUT}`}
          value={draft.variantId}
          onChange={(e) => selectVariant(e.target.value)}
        >
          {!variantsForSong.some((v) => v.id === draft.variantId) && <option value={draft.variantId}>{draft.variantLabel} (neu)</option>}
          {variantsForSong.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.isDefault ? `${variant.label} (Standard)` : variant.label}
            </option>
          ))}
        </select>
        {variantActions.length > 0 && <ActionMenu title={`Variante „${draft.variantLabel}“`} actions={variantActions} />}
      </div>
      {/* Adding a variant looks like adding anywhere else (docs/15 AddRow), not hidden in the ⋯
          (Marco, 2026-10-20). */}
      <AddRow label="Neue Variante" onClick={addVariant} />
      {!hasDefault && variantsForSong.length > 0 && (
        <p role="alert" className="rounded-control border border-warn/60 bg-warn/20 px-3 py-2 text-base text-ink">
          Dieser Song hat keine Standard-Variante. Setlist-Einträge ohne eigene Variante spielen nichts, bis du eine Variante als
          Standard festlegst (⋯ neben der Variante).
        </p>
      )}
    </div>
  )

  const previewPane = (
    <div ref={previewRef} className="min-h-0 flex-1 overflow-y-auto rounded-container border border-line bg-surface p-4 shadow-sb min-[600px]:p-6">
      <ChordProLyrics lines={preview} activeIndex={caretIndex} onSourceTap={jumpToSource} chordInfo />
    </div>
  )

  const trackCaret = (e: { currentTarget: HTMLTextAreaElement }) => setCaret(e.currentTarget.selectionStart)
  // Unclosed [ or { (#605) - a hint naming the line, never fixed by itself.
  const brackets = bracketProblems(settledText)
  // Little height with the keyboard up: the text alone (#617) - no variant row above it. Where
  // enough is left (a tablet in portrait: ~690 px), the variant row stays (Marco, 2026-10-28).
  // The settled visible area (its blip while the keyboard comes up is filtered there). Not the page
  // height: in landscape the app's WebView keeps its full height and the keyboard just covers it
  // (Redmi, 2026-10-29) - the page said "room enough" with the text behind the keyboard.
  const roomPx = visible?.height ?? (typeof window === 'undefined' ? 0 : window.innerHeight)
  // What the keyboard covers of the page (landscape) - the text pane ends above it.
  const keyboardCover = keyboardOpen && visible && typeof window !== 'undefined' ? Math.max(0, window.innerHeight - (visible.offsetTop + visible.height)) : 0
  // Two columns too: in landscape with the keyboard up only ~250 px are left (Redmi, 2026-10-29).
  const typingOnPhone = textFocused && roomPx < ROOMY_FOR_VARIANT_ROW_PX
  // Even less (landscape, keyboard up): the page header steps aside as well while typing - it is
  // back the moment the keyboard goes down.
  const headerAside = keyboardOpen && roomPx < ROOMY_FOR_HEADER_PX
  // A phone in landscape with the keyboard up: a hint, not a forced turn (Marco, 2026-10-29).
  const crampedOnPhone = textFocused && keyboardOpen && roomPx < CRAMPED_TYPING_PX && typeof window !== 'undefined' && Math.min(window.screen.width, window.screen.height) < 600
  if (crampedOnPhone && !portraitHintShown.current) {
    portraitHintShown.current = true
    queueMicrotask(() => setPortraitHint(true))
  }
  // The search bar with little room (keyboard up, landscape, a phone): one row, and the variant
  // row steps aside - on the Redmi with the keyboard up only two lines of text were left (2026-10-29).
  const compactSearch = roomPx < ROOMY_FOR_FULL_SEARCH_PX || (typeof window !== 'undefined' && window.innerWidth < 600)
  const hideVariantRow = typingOnPhone || (findBar !== null && compactSearch)
  // The key bar lies over the bottom of the page - the text field ends above it (no room kept for it
  // where it steps aside).
  const textPane = (
    <div className={`flex min-h-0 flex-1 flex-col gap-2 ${textFocused && keyboardOpen && roomPx >= CRAMPED_TYPING_PX ? 'pb-form' : ''}`} style={keyboardCover > 0 ? { marginBottom: keyboardCover } : undefined}>
      {!hideVariantRow && variantRow}
      {toolUndo && (
        <div className="flex items-center gap-2 rounded-control bg-control px-3 text-base text-ink">
          <span className="min-w-0 flex-1 truncate">{toolUndo.label}</span>
          <Button
            variant="quiet"
            onClick={() => {
              setDraft({ ...draft, chordProContent: toolUndo.before })
              setToolUndo(null)
            }}
          >
            Rückgängig
          </Button>
        </div>
      )}
      {findBar && (
        <FindReplaceBar
          content={draft.chordProContent}
          range={findBar.range}
          memory={findMemory}
          compact={compactSearch}
          onMarks={onFindMarks}
          onClose={() => {
            // The search left its last match selected - that is no marking of lines for the next tool.
            const textarea = textareaRef.current
            if (textarea) textarea.setSelectionRange(textarea.selectionEnd, textarea.selectionEnd)
            setFindBar(null)
          }}
          onReplace={(after, label) => {
            const before = draft.chordProContent
            setDraft({ ...draft, chordProContent: after })
            setToolUndo({ before, label })
          }}
        />
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1">
      {portraitHint && (
        <p role="status" className="pointer-events-none absolute inset-x-2 top-2 z-content rounded-control bg-surface px-3 py-2 text-base text-ink shadow-sb">
          Im Hochformat ist mehr Platz zum Schreiben.
        </p>
      )}
      {(showInvisibles || findMarks.marks.length > 0) && <EditorBackdrop text={draft.chordProContent} textarea={textareaRef} showInvisibles={showInvisibles} marks={findMarks.marks} />}
      <textarea
        ref={textareaRef}
        aria-label="ChordPro-Text"
        className={`relative min-h-0 flex-1 min-w-0 p-2 font-sb-mono text-base ${INPUT_FREE} ${showInvisibles || findMarks.marks.length > 0 ? '!bg-transparent' : ''}`}
        value={draft.chordProContent}
        onChange={(e) => {
          setDraft({ ...draft, chordProContent: e.target.value })
          setToolUndo(null)
          trackCaret(e)
        }}
        onSelect={trackCaret}
        onFocus={() => setTextFocused(true)}
        onBlur={(e) => {
          setTextFocused(false)
          trackCaret(e)
        }}
        onBeforeInput={(e) => {
          const textarea = e.currentTarget
          if ((e.nativeEvent as InputEvent).data === '[' && textarea.selectionStart !== textarea.selectionEnd) {
            e.preventDefault()
            typeChordProKey('[')
          }
        }}
        placeholder="[00:00.00] Come on baby [G] don't you wanna go"
      />
      </div>
      {brackets.length > 0 && (
        <p role="status" className="text-sm text-warn">
          {brackets
            .slice(0, 3)
            .map((problem) => `Zeile ${problem.line}: „${problem.bracket}“ nicht geschlossen`)
            .join(' · ')}
          {brackets.length > 3 && ` · +${brackets.length - 3}`}
        </p>
      )}
      <ChordProKeyBar
        // A phone in landscape with the keyboard up has ~140 px left - the text lines first.
        active={textFocused && roomPx >= CRAMPED_TYPING_PX}
        chords={songChords(preview)}
        onKey={typeChordProKey}
        onChord={(chord) => typeAtCaret(`[${chord}]`)}
        onInsertMenu={() => setInsertMenuOpen(true)}
      />
    </div>
  )

  // Speichern lives in the page header, top right, and never scrolls away (#603, docs/15 D11) -
  // the same row in every view. Leaving goes through ← / Back, which asks about unsaved changes
  // (lib/unsavedChanges).
  const pageHeader = (
    <div className="flex items-center gap-1 min-[600px]:gap-2">
      {/* Phone: icons instead of words (#603). From 600 px the words come back. */}
      <Button aria-label="Bibliothek" title="Bibliothek" className="max-[599px]:px-3" onClick={() => void leave()}>
        <Icon name="back" />
        <span className="max-[599px]:hidden">Bibliothek</span>
      </Button>
      <div className="min-w-0 flex-1">{viewSwitch}</div>
      {savedAt && <span className="text-sm text-ink-faint max-[599px]:hidden">Gespeichert.</span>}
      <IconButton icon={menuIcon('page')} label="Menü: Song-Editor" onClick={() => setPageMenuOpen(true)} />
      <Button variant="primary" aria-label="Speichern" title="Speichern" className="max-[599px]:px-3" onClick={() => void handleSave()}>
        <Icon name="save" size="1.4em" className="min-[600px]:hidden" />
        <span className="max-[599px]:hidden">Speichern</span>
      </Button>
    </div>
  )

  return (
    <div className="flex h-full flex-col gap-2 sb-app-bg p-3 text-ink max-[599px]:p-2">
      {!headerAside && pageHeader}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex min-h-0 flex-1 flex-col">
        {view === 'timeline' ? (
          <div className="min-h-0 flex-1">{timelineContent}</div>
        ) : view === 'details' ? (
          <div className="min-h-0 flex-1 overflow-y-auto">{detailsView}</div>
        ) : view === 'preview' ? (
          previewPane
        ) : isPanel ? (
          // Wide screens: text and preview side by side, each scrolling on its own (#617). With
          // very little room (keyboard up in landscape) the preview column hides - by CSS, never by
          // a different tree: rebuilding the text field took its focus and closed the keyboard again.
          <div className={`grid min-h-0 flex-1 gap-3 [&>*]:min-h-0 ${headerAside ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {textPane}
            <div className={`flex min-h-0 flex-col ${headerAside ? 'hidden' : ''}`}>{previewPane}</div>
          </div>
        ) : (
          textPane
        )}
      </div>
      {pageMenuOpen && <ActionMenuDialog title="Song-Editor" actions={pageActions} onClose={() => setPageMenuOpen(false)} />}
      {toolsMenuOpen && <ActionMenuDialog title="Textwerkzeuge" actions={toolActions} onClose={() => setToolsMenuOpen(false)} />}
      {toolDialog?.kind === 'cleanup' && (
        <CleanupDialog
          text={draft.chordProContent.slice(toolDialog.start, toolDialog.end)}
          scope={toolDialog.scope}
          onCancel={() => setToolDialog(null)}
          onApply={(after) => {
            applyTextTool('Aufgeräumt', () => after, toolDialog)
            setToolDialog(null)
          }}
        />
      )}
      {insertMenuOpen && <ActionMenuDialog title="Einfügen" actions={insertActions} onClose={() => setInsertMenuOpen(false)} />}
      {textFix && <TextFixDialog offers={textFix.offers} onSave={textFix.resolve} onCancel={() => textFix.resolve(null)} />}
      {noteDialog === 'comment' && <InsertCommentDialog onInsert={insertLinesAtCaret} onClose={() => setNoteDialog(null)} />}
      {noteDialog === 'tab' && <InsertTabDialog onInsert={insertLinesAtCaret} onClose={() => setNoteDialog(null)} />}
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
