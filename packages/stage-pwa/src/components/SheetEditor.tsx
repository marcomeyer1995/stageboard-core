import { useEffect, useRef, useState } from 'react'
import {
  SongSchema,
  SongVariantSchema,
  CAPABILITIES,
  type BeatAnchor,
  type Song,
  type ShowCue,
  type SongVariant,
  type TempoMarker,
  type TimecodeMarker,
} from 'shared-types'
import { analyzeTempoMapBlob, analyzeTrackBlob } from '../lib/analyzeTrack'
import { pluginProviding } from '../lib/capabilities'
import { parseChordPro } from '../lib/chordpro'
import { randomId } from '../lib/id'
import { ensureDefaultVariant, getTrack } from '../lib/songVariantsDb'
import { useIsPanelLayout } from '../lib/useIsPanelLayout'
import { useDialogStore } from '../store/useDialogStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { BeatAnchorListEditor } from './BeatAnchorListEditor'
import { ChordProLyrics } from './ChordProLyrics'
import { CommentListEditor } from './CommentListEditor'
import { CueListEditor } from './CueListEditor'
import { TabImportOverlay, type ImportedSongData } from './TabImportOverlay'
import { TapBeatAnchors } from './TapBeatAnchors'
import { TapTempoMarker } from './TapTempoMarker'
import { TapToSync } from './TapToSync'
import { TempoMarkerListEditor } from './TempoMarkerListEditor'
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
  timeSignature: string
  clickTrackEnabled: boolean
  chordProContent: string
  timecodes: TimecodeMarker[]
  cues: ShowCue[]
  beatAnchors: BeatAnchor[]
  tempoMarkers: TempoMarker[]
  countInEnabled: boolean
  countInBars: number
  key?: string
  tuning?: string
  capo?: number
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
    beatAnchors: variant.beatAnchors,
    tempoMarkers: variant.tempoMarkers,
    countInEnabled: variant.countInEnabled,
    countInBars: variant.countInBars,
    key: variant.key,
    tuning: variant.tuning,
    capo: variant.capo,
  }
}

type EditorLayout = 'phoneTabs' | 'tabletPortraitSheet' | 'panel'

/** Screen-class detection for the Text/Details split (#177) - phone and tablet portrait get a
 * tab switcher (tablet portrait renders Details as a bottom sheet over Text rather than
 * replacing it, since there's more vertical room), landscape and desktop show both panes at
 * once. The 'panel' tier itself is useIsPanelLayout.ts, shared with LibraryView.tsx's own
 * single-focus-vs-two-pane switch (#178) - the second consumer that justified pulling it out
 * of this hook, which keeps only its own extra 'tabletPortraitSheet' tier local. */
function useEditorLayout(): EditorLayout {
  const isPanel = useIsPanelLayout()
  const [isPortraitTablet, setIsPortraitTablet] = useState(
    () => window.matchMedia('(min-width: 640px)').matches && window.matchMedia('(orientation: portrait)').matches,
  )

  useEffect(() => {
    const queries = [window.matchMedia('(min-width: 640px)'), window.matchMedia('(orientation: portrait)')]
    const update = () =>
      setIsPortraitTablet(
        window.matchMedia('(min-width: 640px)').matches && window.matchMedia('(orientation: portrait)').matches,
      )
    queries.forEach((q) => q.addEventListener('change', update))
    return () => queries.forEach((q) => q.removeEventListener('change', update))
  }, [])

  if (isPanel) return 'panel'
  if (isPortraitTablet) return 'tabletPortraitSheet'
  return 'phoneTabs'
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
  const saveVariant = useSongVariantsStore((state) => state.saveVariant)
  const confirm = useDialogStore((state) => state.confirm)
  const installedPlugins = usePluginsStore((state) => state.installed)
  // null only until the first `selectSong` resolves - there's no more "new, unsaved song"
  // state to represent here, since creation now happens in LibraryView before this editor
  // ever opens (it always receives a real songId for a song that already exists).
  const [draft, setDraft] = useState<EditorDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [isTapping, setIsTapping] = useState(false)
  const [isTappingAnchors, setIsTappingAnchors] = useState(false)
  const [isTappingTempoMarker, setIsTappingTempoMarker] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [isAnalyzingTempoMap, setIsAnalyzingTempoMap] = useState(false)
  const [tempoMapError, setTempoMapError] = useState<string | null>(null)
  const [tapTrackSrc, setTapTrackSrc] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const layout = useEditorLayout()
  const [mobileTab, setMobileTab] = useState<'text' | 'tempo' | 'audio' | 'cues' | 'comments'>('text')
  // Every section starts collapsed (Marco, explicit request) - opening a song for editing
  // shows just the always-visible header (Titel/Band/Key/Tuning/Capo) until something is
  // deliberately expanded, not a screenful of whichever section used to default open.
  const [textExpanded, setTextExpanded] = useState(false)
  const [tempoExpanded, setTempoExpanded] = useState(false)
  const [audioExpanded, setAudioExpanded] = useState(false)
  const [cuesExpanded, setCuesExpanded] = useState(false)
  const [commentsExpanded, setCommentsExpanded] = useState(false)

  const variantsForSong = draft ? variants.filter((v) => v.songId === draft.songId) : []
  const currentTracks = draft ? (variants.find((v) => v.id === draft.variantId)?.tracks ?? []) : []
  // Prefer the band's own mix; a reference track (e.g. extracted YouTube audio) is still
  // useful to tap along to when no band-mix has been recorded yet.
  const tapTrack =
    currentTracks.find((t) => t.kind === 'band-mix') ?? currentTracks.find((t) => t.kind === 'reference') ?? null

  useEffect(() => {
    setTapTrackSrc(null)
    if (!draft || (!isTapping && !isTappingAnchors && !isTappingTempoMarker) || !tapTrack) return
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
  }, [isTapping, isTappingAnchors, isTappingTempoMarker, draft?.variantId, tapTrack?.id])

  async function selectSong(id: string, preferredVariantId?: string | null) {
    const song = songs.find((s) => s.id === id)
    if (!song) return
    const defaultVariant = await ensureDefaultVariant(song)
    const variant = preferredVariantId
      ? (variants.find((v) => v.id === preferredVariantId) ?? defaultVariant)
      : defaultVariant
    setDraft(draftFrom(song, variant))
    setError(null)
    setSavedAt(null)
  }

  useEffect(() => {
    void selectSong(songId, variantId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, variantId])

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
    return <div className="flex h-dvh items-center justify-center text-ink-faint">Lade…</div>
  }

  const selectVariant = (variantId: string) => {
    const variant = variantsForSong.find((v) => v.id === variantId)
    if (!variant) return
    setDraft({
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
      beatAnchors: variant.beatAnchors,
      tempoMarkers: variant.tempoMarkers,
      countInEnabled: variant.countInEnabled,
      countInBars: variant.countInBars,
      key: variant.key,
      tuning: variant.tuning,
      capo: variant.capo,
    })
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

  const handleSave = async () => {
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
      beatAnchors: draft.beatAnchors,
      tempoMarkers: draft.tempoMarkers,
      countInEnabled: draft.countInEnabled,
      countInBars: draft.countInBars,
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
      timeSignature: defaultVariant?.timeSignature ?? draft.timeSignature,
      clickTrackEnabled: defaultVariant?.clickTrackEnabled ?? draft.clickTrackEnabled,
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
  }

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

  /** Ultimate Guitar's own bpm/key/tuning/capo only ever come in on top of whatever the
   * import found - a missing field there must not silently overwrite a value already in the
   * editor (e.g. a capo the previous variant had that this particular tab just doesn't list). */
  const handleImport = (imported: ImportedSongData) => {
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

  /** Automatic BPM + beat-anchor detection (#25 follow-up) - runs the DSP pipeline
   * (audioAnalysis.ts/analyzeTrack.ts) against `tapTrack`'s own audio, the same track the manual
   * tap tools already work against. Replaces the whole anchor list rather than merging into it
   * (same "auto-fill-then-editable" convention `handleImport` above already uses for Ultimate
   * Guitar's bpm/key/tuning) - guarded by a confirmation when anchors already exist, since a
   * stray click shouldn't silently wipe out anchors someone already hand-tapped (manual
   * correction always wins - installing/uninstalling a detection plugin never overrides that).
   * Detection is inherently imperfect on real mixes (no single unambiguous transient at every
   * beat) - the list editor and tap tool right below this button are the correction mechanism,
   * not an afterthought.
   *
   * Uses the `music-tempo-beat-detection` plugin (far more accurate, see musicTempoAnalysis.ts's
   * own doc comment) if a band has installed+enabled it (CAPABILITIES.audioAnalysis); otherwise
   * falls back to the always-available hand-rolled detector - no plugin required at all, same as
   * manual tap-to-sync. */
  const handleAnalyzeTrack = async () => {
    if (!tapTrack) return
    if (draft.beatAnchors.length > 0) {
      const confirmed = await confirm('Vorhandene Anker durch die automatische Erkennung ersetzen?', {
        confirmLabel: 'Ersetzen',
      })
      if (!confirmed) return
    }
    setIsAnalyzing(true)
    setAnalyzeError(null)
    try {
      const blob = await getTrack(draft.variantId, tapTrack.id)
      if (!blob) {
        setAnalyzeError('Track nicht verfügbar.')
        return
      }
      const provider = pluginProviding(installedPlugins, CAPABILITIES.audioAnalysis) ? 'music-tempo' : 'hand-rolled'
      const result = await analyzeTrackBlob(blob, draft.timeSignature, provider)
      if (result.bpm === null && result.beatAnchors.length === 0) {
        setAnalyzeError('Keine Analyse möglich - bitte manuell setzen.')
        return
      }
      setDraft((d) =>
        d
          ? {
              ...d,
              bpm: result.bpm ?? d.bpm,
              beatAnchors: result.beatAnchors.map((a) => ({ id: randomId(), timeMs: a.timeMs, beatInBar: a.beatInBar })),
            }
          : d,
      )
    } catch {
      setAnalyzeError('Analyse fehlgeschlagen.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  /** "Tempo-Wechsel erkennen" - unlike handleAnalyzeTrack above (one global bpm), suggests a
   * whole tempo-map: a base bpm plus every later place the tempo genuinely seems to change.
   * Always a suggestion to review, never applied silently - see analyzeTempoMapBlob's own doc
   * comment for why (it can still return an exact octave-doubled/halved tempo on
   * metrically-ambiguous material like a slow ballad with a strong 2-beat feel). */
  const handleAnalyzeTempoMap = async () => {
    if (!tapTrack) return
    if (draft.tempoMarkers.length > 0) {
      const confirmed = await confirm('Vorhandene Tempo-Wechsel durch die automatische Erkennung ersetzen?', {
        confirmLabel: 'Ersetzen',
      })
      if (!confirmed) return
    }
    setIsAnalyzingTempoMap(true)
    setTempoMapError(null)
    try {
      const blob = await getTrack(draft.variantId, tapTrack.id)
      if (!blob) {
        setTempoMapError('Track nicht verfügbar.')
        return
      }
      const result = await analyzeTempoMapBlob(blob)
      if (result === null) {
        setTempoMapError('Keine Analyse möglich - bitte manuell setzen.')
        return
      }
      if (result.tempoMarkers.length === 0) {
        setTempoMapError('Kein Tempo-Wechsel erkannt - BPM übernommen.')
      }
      setDraft((d) =>
        d
          ? {
              ...d,
              bpm: result.baseBpm,
              tempoMarkers: result.tempoMarkers.map((m) => ({ id: randomId(), timeMs: m.timeMs, bpm: m.bpm })),
            }
          : d,
      )
    } catch {
      setTempoMapError('Analyse fehlgeschlagen.')
    } finally {
      setIsAnalyzingTempoMap(false)
    }
  }

  const preview = parseChordPro(draft.chordProContent)

  // Split three ways (#180, following #177's own Text/Details split): Tempo & Takt is plain
  // fields, set once and rarely revisited; Klick-Sync is the tool-heavy piece (tap tools,
  // analysis, the anchor/marker list editors) - by far the bulkiest part of the old, single
  // Details tab; Audio & Cues is external resources attached to the song. Identical content on
  // every layout; only how each is framed (tab, bottom sheet, collapsible section) differs.
  // One topic, not two (#180 follow-up): BPM/Takt/click/count-in are the "set it and glance at
  // it" basics, and the click-sync tooling below the divider is the same topic gone deeper -
  // splitting them into separate tabs grouped by field complexity rather than by subject put
  // Klick-Sync in a different tab from the tempo settings it exists to serve. Count-in moved
  // in from what used to be the sync-only tab, for the same reason: it's a basic click setting,
  // not an analysis tool, so it belongs with click-enabled rather than the tap/analyze tools.
  const tempoContent = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          BPM
          <input
            type="number"
            className="rounded-sb-sm bg-control px-2 py-1 text-ink"
            value={draft.bpm}
            onChange={(e) => setDraft({ ...draft, bpm: Number(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Takt
          <input
            className="rounded-sb-sm bg-control px-2 py-1 text-ink"
            placeholder="4/4"
            value={draft.timeSignature}
            onChange={(e) => setDraft({ ...draft, timeSignature: e.target.value })}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={draft.clickTrackEnabled}
          onChange={(e) => setDraft({ ...draft, clickTrackEnabled: e.target.checked })}
          className="h-5 w-5"
        />
        Klick standardmäßig an (per Show überstimmbar)
      </label>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={draft.countInEnabled}
            onChange={(e) => setDraft({ ...draft, countInEnabled: e.target.checked })}
            className="h-5 w-5"
          />
          Count-in aktivieren
        </label>
        <label className="flex items-center gap-1 text-sm text-ink-muted">
          Takte
          <input
            type="number"
            min={1}
            disabled={!draft.countInEnabled}
            className="w-16 rounded-sb-sm bg-control px-2 py-1 text-ink disabled:opacity-40"
            value={draft.countInBars}
            onChange={(e) => setDraft({ ...draft, countInBars: Math.max(1, Number(e.target.value)) })}
          />
        </label>
      </div>

      {isTappingAnchors ? (
        <TapBeatAnchors
          trackSrc={tapTrackSrc}
          timeSignature={draft.timeSignature}
          onComplete={(anchors) => {
            setDraft({ ...draft, beatAnchors: [...draft.beatAnchors, ...anchors].sort((a, b) => a.timeMs - b.timeMs) })
            setIsTappingAnchors(false)
          }}
          onCancel={() => setIsTappingAnchors(false)}
        />
      ) : isTappingTempoMarker ? (
        <TapTempoMarker
          trackSrc={tapTrackSrc}
          onComplete={(timeMs) => {
            const marker: TempoMarker = { id: randomId(), timeMs, bpm: draft.bpm }
            setDraft({ ...draft, tempoMarkers: [...draft.tempoMarkers, marker].sort((a, b) => a.timeMs - b.timeMs) })
            setIsTappingTempoMarker(false)
          }}
          onCancel={() => setIsTappingTempoMarker(false)}
        />
      ) : (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-muted">Klick-Synchronisation</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleAnalyzeTrack()}
                disabled={!tapTrack || isAnalyzing}
                className="rounded-sb-sm bg-control-strong px-2 py-0.5 text-xs text-ink hover:bg-control-strong-hover disabled:opacity-40"
              >
                {isAnalyzing ? 'Analysiere…' : 'Track analysieren'}
              </button>
              <button
                type="button"
                onClick={() => setIsTappingAnchors(true)}
                disabled={!tapTrack}
                className="rounded-sb-sm bg-control-strong px-2 py-0.5 text-xs text-ink hover:bg-control-strong-hover disabled:opacity-40"
              >
                Anker tappen
              </button>
              <button
                type="button"
                onClick={() => setIsTappingTempoMarker(true)}
                disabled={!tapTrack}
                className="rounded-sb-sm bg-control-strong px-2 py-0.5 text-xs text-ink hover:bg-control-strong-hover disabled:opacity-40"
              >
                Tempo-Wechsel markieren
              </button>
              <button
                type="button"
                onClick={() => void handleAnalyzeTempoMap()}
                disabled={!tapTrack || isAnalyzingTempoMap}
                title="Vorschlag - bitte prüfen, kann bei mehrdeutigem Metrum die falsche Oktave treffen (z.B. halbe/doppelte BPM bei einer Ballade)"
                className="rounded-sb-sm bg-control-strong px-2 py-0.5 text-xs text-ink hover:bg-control-strong-hover disabled:opacity-40"
              >
                {isAnalyzingTempoMap ? 'Erkenne…' : 'Tempo-Wechsel erkennen'}
              </button>
            </div>
          </div>
          {analyzeError && <p className="text-xs text-red-500">{analyzeError}</p>}
          {tempoMapError && <p className="text-xs text-red-500">{tempoMapError}</p>}
          <BeatAnchorListEditor
            anchors={draft.beatAnchors}
            timeSignature={draft.timeSignature}
            onChange={(beatAnchors) => setDraft({ ...draft, beatAnchors })}
          />
          <p className="text-xs text-ink-faint">Automatisch erkannte Anker bitte prüfen.</p>
          <TempoMarkerListEditor
            tempoMarkers={draft.tempoMarkers}
            onChange={(tempoMarkers) => setDraft({ ...draft, tempoMarkers })}
          />
          <p className="text-xs text-ink-faint">
            Automatisch erkannte Tempo-Wechsel bitte prüfen - bei mehrdeutigem Metrum (z.B. einer Ballade) kann die
            BPM-Oktave falsch sein.
          </p>
        </div>
      )}
    </div>
  )

  // Audio (attached recordings) and Cues (show-control triggers) are different topics that
  // used to share one "leftover" tab - split for the same reason.
  const audioContent = (
    <TrackManagerField
      variantId={draft.variantId}
      tracks={currentTracks}
      // True only for a variant that exists in this draft but not yet in the store - i.e. a
      // fresh "+ Neue Variante" click that hasn't been saved yet, not "this song is new" (that
      // state no longer exists here at all - see the props/selectSong doc comments above).
      disabled={!variantsForSong.some((v) => v.id === draft.variantId)}
    />
  )

  const cuesContent = <CueListEditor cues={draft.cues} onChange={(cues) => setDraft({ ...draft, cues })} />
  const commentsContent = (
    <CommentListEditor
      content={draft.chordProContent}
      onChange={(chordProContent) => setDraft({ ...draft, chordProContent })}
    />
  )

  // `label` for the (space-constrained) phone tab strip, `fullLabel` for the desktop accordion
  // headers, which have the room to spell it out.
  const detailSections = [
    {
      key: 'tempo' as const,
      label: 'Tempo',
      fullLabel: 'Tempo & Klick',
      content: tempoContent,
      expanded: tempoExpanded,
      onToggleExpand: () => setTempoExpanded((v) => !v),
    },
    {
      key: 'audio' as const,
      label: 'Audio',
      fullLabel: 'Audio',
      content: audioContent,
      expanded: audioExpanded,
      onToggleExpand: () => setAudioExpanded((v) => !v),
    },
    {
      key: 'cues' as const,
      label: 'Cues',
      fullLabel: 'Cues',
      content: cuesContent,
      expanded: cuesExpanded,
      onToggleExpand: () => setCuesExpanded((v) => !v),
    },
    {
      key: 'comments' as const,
      label: 'Kommentare',
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
            <button
              type="button"
              onClick={insertComment}
              className="rounded-sb-sm bg-control-strong px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink-faint hover:bg-control-strong-hover"
            >
              + Kommentar
            </button>
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
      {layout !== 'panel' && (
        <div className="rounded-sb border border-line bg-surface p-4 shadow-sb">
          <ChordProLyrics lines={preview} />
        </div>
      )}
    </div>
  )

  const showText = layout !== 'phoneTabs' || mobileTab === 'text'

  return (
    // Grid vs. stacked is driven by `layout`, not a Tailwind breakpoint directly - 'panel'
    // covers both landscape (from md, regardless of exact width) and desktop (xl+), which
    // isn't expressible as a single Tailwind prefix. In 'phoneTabs'/'tabletPortraitSheet',
    // Text and Details share one column and swap via tabs instead of both being visible.
    <div
      className={`flex h-dvh gap-3 overflow-y-auto sb-app-bg p-3 text-ink ${
        layout === 'panel' ? 'grid grid-cols-2' : 'flex-col'
      }`}
    >
      <div className="flex flex-col gap-3 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb">
        {/* Switching to a different song, creating a new one, and deleting this one all moved
            to LibraryView's own tree (its "+ Neu" and each row's ⋯ menu) - going back there is
            how you pick a different song now, not a dropdown duplicating the same list. */}
        <button
          type="button"
          onClick={onBack}
          className="self-start rounded-sb-sm bg-control-strong px-3 py-1 text-sm hover:bg-control-strong-hover"
        >
          ← Bibliothek
        </button>
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

        {/* Always visible regardless of which section is open below - context for "which song
            is this, and how do I play it" rather than something tucked behind a section that
            has to be opened first. Key/Tuning/Capo moved here from their own now-removed
            Arrangement section (Marco, explicit request) - same always-visible treatment as
            Titel/Band, not a collapsible cluster of its own. */}
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
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Key
            <input
              className="rounded-sb-sm bg-control px-2 py-1 text-ink"
              value={draft.key ?? ''}
              onChange={(e) => setDraft({ ...draft, key: e.target.value || undefined })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Tuning
            <input
              className="rounded-sb-sm bg-control px-2 py-1 text-ink"
              value={draft.tuning ?? ''}
              onChange={(e) => setDraft({ ...draft, tuning: e.target.value || undefined })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
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

        {/* Below lg only - landscape/desktop show every section at once (as collapsible
            accordions below) and need no switcher. Four tabs (#180's follow-up separated
            Audio/Cues; Key/Tuning/Capo's own Arrangement tab was later folded into the
            always-visible header above instead), so the strip scrolls horizontally rather than
            stretching each tab thinner - same pattern SystemView.tsx already uses for its own
            seven tabs, not a new idiom. */}
        {layout !== 'panel' && (
          <div className="flex gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => setMobileTab('text')}
              className={`h-10 flex-shrink-0 rounded-sb-pill px-4 text-sm font-medium ${
                mobileTab === 'text' ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft hover:bg-control-hover'
              }`}
            >
              Text
            </button>
            {detailSections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setMobileTab(section.key)}
                className={`h-10 flex-shrink-0 rounded-sb-pill px-4 text-sm font-medium ${
                  mobileTab === section.key
                    ? 'bg-accent text-accent-ink'
                    : 'bg-control text-ink-soft hover:bg-control-hover'
                }`}
              >
                {section.label}
              </button>
            ))}
          </div>
        )}

        {layout === 'panel' ? (
          // Its own collapsible accordion here too (Marco, explicit request) - no longer the
          // one section that could never be hidden. Expanded by default (`textExpanded`'s own
          // initial value above), unlike the others below it.
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setTextExpanded((v) => !v)}
              className="flex items-center gap-2 self-start text-sm font-medium text-ink-soft hover:text-ink"
            >
              <span>{textExpanded ? '▾' : '▸'}</span> Text
            </button>
            {textExpanded && textContent}
          </div>
        ) : (
          showText && textContent
        )}

        {layout === 'panel'
          ? // Landscape/desktop: every section at once, each an independently-collapsible
            // accordion (#180 - three of these where #177 had one).
            detailSections.map((section) => (
              <div key={section.key} className="flex flex-col gap-3 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={section.onToggleExpand}
                  className="flex items-center gap-2 self-start text-sm font-medium text-ink-soft hover:text-ink"
                >
                  <span>{section.expanded ? '▾' : '▸'}</span> {section.fullLabel}
                </button>
                {section.expanded && section.content}
              </div>
            ))
          : mobileTab !== 'text' &&
            (() => {
              const active = detailSections.find((section) => section.key === mobileTab)
              if (!active) return null
              if (layout === 'tabletPortraitSheet') {
                // Overlaid on top of Text rather than replacing it - tablet portrait has the
                // vertical room to spare (#177). `fixed`, not `absolute` - the column behind
                // it scrolls (`overflow-y-auto`), and an absolutely positioned sheet would
                // scroll away with it instead of staying pinned to the viewport like a real
                // bottom sheet.
                return (
                  <div className="fixed inset-x-0 bottom-0 z-20 flex max-h-[55dvh] flex-col gap-3 overflow-y-auto rounded-t-sb border-t border-line bg-surface p-4 shadow-sb">
                    <div className="flex items-center justify-between">
                      <span className="h-1 w-10 self-center rounded-sb-pill bg-control-strong" />
                      <button
                        type="button"
                        onClick={() => setMobileTab('text')}
                        className="rounded-sb-sm bg-control px-3 py-1 text-sm text-ink-soft hover:bg-control-hover"
                      >
                        Fertig
                      </button>
                    </div>
                    {active.content}
                  </div>
                )
              }
              // phoneTabs: full pane, same as Text - only one of the four is ever mounted.
              return active.content
            })()}

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
      {/* Its own grid column only in 'panel' layout - otherwise the preview already renders
          inline at the end of `textContent`, right below the textarea. */}
      {layout === 'panel' && (
        <div className="overflow-y-auto rounded-sb border border-line bg-surface p-6 shadow-sb">
          <ChordProLyrics lines={preview} />
        </div>
      )}
      {isImporting && <TabImportOverlay onImport={handleImport} onClose={() => setIsImporting(false)} />}
    </div>
  )
}
