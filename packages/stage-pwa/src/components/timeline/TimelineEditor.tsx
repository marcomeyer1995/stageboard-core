import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BeatGrid, ShowCue } from 'shared-types'
import { beatsBetween, clickTimeline, gridStretches, newGrid, removePoint, setMeter, setPoint, tempoFromTaps } from '../../lib/beatGrid'
import { startClick, stopClick } from '../../lib/clickEngine'
import { describeCue } from '../../lib/deviceCommands'
import {
  barLabelEvery,
  barQuality,
  clampView,
  formatTimelineTime,
  nextProblemBar,
  PART_FILL,
  timeToX,
  tokenColor,
  wrapText,
  xToTime,
  zoomAround,
  laneLayout,
  TIMELINE_LANES,
  type TimelineLane,
  type TimelineView,
} from '../../lib/timeline'
import { addCue, mergeCues, moveCue, removeCue, updateCue } from '../../lib/timelineCues'
import { insertComment, lineAtTime, moveNote, removeNote, setNoteTargets, setNoteText, timelineNotes } from '../../lib/timelineNotes'
import { lineTimeBounds, partBlocks, setLineTime, stampLines, tapLines, tapStartLine, timelineLines } from '../../lib/timelineText'
import { loadTrackAnalysis, type TrackAnalysis } from '../../lib/trackAnalysis'
import { useElementSize } from '../../lib/useElementSize'
import { useTrackClock } from '../../lib/useTrackClock'
import { useTimelineLanesStore } from '../../store/useTimelineLanesStore'
import { useClockStore } from '../../store/useClockStore'
import { useDialogStore } from '../../store/useDialogStore'
import { useLogicalDevicesStore } from '../../store/useLogicalDevicesStore'
import { CueRecorder } from '../CueRecorder'
import { TargetPicker } from '../CommentListEditor'
import { useProfilesStore } from '../../store/useProfilesStore'
import { CueDialog, type CueContent } from './CueDialog'
import { TimelineMinimap } from './TimelineMinimap'

/** What the timeline changes on the song: its grid, its bpm (kept equal to the grid's first
 * stretch, so count-in and tempo displays agree with the click), the ChordPro text (the lines'
 * time tags) and the cues. */
export interface TimelineEditState {
  beatGrid: BeatGrid | undefined
  bpm: number
  chordProContent: string
  cues: ShowCue[]
}

export interface TimelineEditorProps {
  variantId: string
  /** The track to show and play (band mix, else reference) - null: grid only. */
  trackId: string | null
  trackSrc: string | null
  beatGrid: BeatGrid | undefined
  bpm: number
  timeSignature: string
  countInEnabled: boolean
  countInBars: number
  /** The song's ChordPro text - its lines and parts are shown, dragging a line writes its time tag. */
  content: string
  /** The variant's show cues (#99) - a lane of their own, moved and edited here. */
  cues: ShowCue[]
  onChange: (next: TimelineEditState) => void
  /** Automatic beat detection turned into a grid (the song editor's "Track analysieren") -
   * applied here as one undoable step. Null: nothing usable detected. */
  onDetectGrid?: () => Promise<{ bpm: number; beatGrid: BeatGrid } | null>
  /** Full screen (docs/14): the lanes take all the height the parent gives the component. */
  fill?: boolean
  /** Opened from the text editor's "Tap-to-Sync" (#325): start "Zeilen tippen" right away;
   * `onLineTappingStarted` lets the parent clear the request so it doesn't repeat on remount. */
  startLineTapping?: boolean
  onLineTappingStarted?: () => void
}

/** "Zurück + 4 s" while tapping lines: how far before the undone tap playback resumes. */
const TAP_REWIND_MS = 4000

/** Lane heights in the compact layout; full screen (`fill`) splits the available height (laneLayout). */
const DEFAULT_AUDIO_H = 96
const SECTION_H = 26
const DEFAULT_GRID_H = 84
const PARTS_H = 28
const DEFAULT_TEXT_H = 64
const NOTES_H = 44
const CUE_H = 44
const LANE_SIZES = { sectionH: SECTION_H, partsH: PARTS_H, notesH: NOTES_H, cueH: CUE_H, defaultAudioH: DEFAULT_AUDIO_H, defaultGridH: DEFAULT_GRID_H, defaultTextH: DEFAULT_TEXT_H }
/** Names of the lanes in the "Spuren" toggles. */
const LANE_NAME: Record<TimelineLane, string> = { audio: 'Wellenform', grid: 'Raster', text: 'Text', notes: 'Notizen', cues: 'Cues' }
/** Two taps within this time and distance in the cue lane add a cue (a double click on the PC). */
const DOUBLE_TAP_MS = 400
const TOLERANCE_PX = 24
const MOVE_THRESHOLD_PX = 6
/** A bar line dropped (or set) within this distance of a detected drum hit lands on it. */
const ONSET_MAGNET_MS = 40
/** A dragged lyric line lands on a beat within this distance, else exactly where it is dropped -
 * sung lines often start just before the beat. */
const LINE_SNAP_MS = 60
/** Stand-in for a song without a grid of its own: bar 1 at 0:00 (what playback assumes too). */
const NO_GRID: BeatGrid = { points: [{ id: 'bar-1', bar: 1, timeMs: 0 }], meters: [] }

const QUALITY_COLOR = { good: '#16a34a', ok: '#d97706', poor: '#dc2626', quiet: '#52525b' } as const
/** Lane names and empty-lane hints (#324): faint, stage-readable size. */
const LANE_LABEL_FONT = '600 16px system-ui, sans-serif'

/** The lane's name at its left edge - only while nothing the lane draws is there, so it never
 * covers a marker or text. `occupied` are the x ranges the lane's content covers. */
function drawLaneLabel(g: CanvasRenderingContext2D, name: string, y: number, occupied: Array<[number, number]>, color: string) {
  g.font = LANE_LABEL_FONT
  const end = 8 + g.measureText(name).width + 8
  if (occupied.some(([a, b]) => b > 0 && a < end)) return
  g.fillStyle = color
  g.fillText(name, 8, y)
}

/** A hint centred in an empty lane - the first of `texts` (longest first) that fits. */
function drawLaneHint(g: CanvasRenderingContext2D, texts: string[], width: number, height: number, color: string) {
  g.font = LANE_LABEL_FONT
  const text = texts.find((t) => g.measureText(t).width <= width - 16) ?? texts[texts.length - 1]!
  g.fillStyle = color
  g.textAlign = 'center'
  g.fillText(text, width / 2, height / 2 + 6)
  g.textAlign = 'left'
}

/** Notes: comments and tab blocks told apart by colour. */
const NOTE_COLOR = { comment: '#38bdf8', tab: '#4ade80' } as const
/** One colour per target device, so a lane full of cues shows at a glance which device each is for. */
const CUE_COLORS = ['#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#a855f7', '#14b8a6'] as const

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return tokenColor(getComputedStyle(document.documentElement).getPropertyValue(name), fallback)
}

/** Undo arrow as an SVG: the ↶/↷ characters came out tiny on the Fire tablet's font, whatever the
 * font size. */
function UndoIcon({ mirrored = false }: { mirrored?: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={mirrored ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

type Pan = { pointerId: number; startX: number; startView: TimelineView; moved: boolean; lane: 'cue' | 'notes' | null }
type Drag = { pointerId: number; startX: number; x: number; moved: boolean } & ({ kind: 'bar'; bar: number } | { kind: 'line'; rawIndex: number } | { kind: 'cue'; id: string } | { kind: 'note'; start: number })
type Selection = { kind: 'bar'; bar: number } | { kind: 'line'; rawIndex: number } | { kind: 'cue'; id: string } | { kind: 'note'; start: number } | null
type TapMode = 'tempo' | 'lines' | null

/** A lyric shortened to fit `maxPx` at roughly 8 px per character. */
function fitText(text: string, maxPx: number): string {
  const chars = Math.floor(maxPx / 8)
  if (chars < 3) return ''
  return text.length <= chars ? text : `${text.slice(0, chars - 1)}…`
}

/**
 * The timeline editor (docs/14): the track's waveform, the click grid (§5a) and the song text
 * (§6) on one time axis. Grid: set bar 1 on the first hit, tap the tempo, drag a bar line onto its
 * hit wherever the ruler drifts - it becomes an alignment point. Text: every lyric line is a
 * marker at its time tag, the song parts are blocks above; drag a line to move its time tag, or
 * tap along to stamp a stretch of lines. Works on the song editor's draft; nothing is written
 * until the song editor saves. Touch and mouse alike: drag a bar line or a line marker = move it,
 * swipe elsewhere = scroll, tap = move the playhead (or select), pinch / Ctrl+wheel = zoom.
 */
export function TimelineEditor(props: TimelineEditorProps) {
  const { variantId, trackId, trackSrc, beatGrid, bpm, timeSignature, countInEnabled, countInBars, content, cues, onChange, onDetectGrid, fill = false, startLineTapping = false, onLineTappingStarted } = props
  const clock = useTrackClock(trackSrc)
  const [sizeRef, box] = useElementSize()
  const [lanesEl, setLanesEl] = useState<HTMLDivElement | null>(null)
  const boxRef = useCallback(
    (el: HTMLDivElement | null) => {
      sizeRef(el)
      setLanesEl(el)
    },
    [sizeRef],
  )
  // Time always runs left to right, in portrait too: a vertical layout for portrait (2026-09-27)
  // was tried and dropped - Marco preferred scrolling sideways on the tablet (2026-09-28).
  const width = Math.max(1, box.width)
  // Collapsed lanes (#328, per device) take no space; the visible ones share the height.
  const hiddenLaneList = useTimelineLanesStore((state) => state.hidden)
  const toggleLane = useTimelineLanesStore((state) => state.toggle)
  const hiddenLanes = useMemo(() => new Set(hiddenLaneList), [hiddenLaneList])
  const layout = laneLayout(fill && box.height > 0 ? box.height : null, hiddenLanes, LANE_SIZES)
  const { totalH: lanesH, audioH, gridH, textH, partsH, gridTop, textTop, notesTop, cueTop } = layout
  const [lanesMenuOpen, setLanesMenuOpen] = useState(false)
  const audioCanvas = useRef<HTMLCanvasElement>(null)
  const gridCanvas = useRef<HTMLCanvasElement>(null)
  const textCanvas = useRef<HTMLCanvasElement>(null)
  const cueCanvas = useRef<HTMLCanvasElement>(null)
  const notesCanvas = useRef<HTMLCanvasElement>(null)
  const profiles = useProfilesStore((state) => state.profiles)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const confirm = useDialogStore((state) => state.confirm)
  const promptFields = useDialogStore((state) => state.promptFields)

  const [analysis, setAnalysis] = useState<TrackAnalysis | null>(null)
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [view, setView] = useState<TimelineView>({ startMs: 0, msPerPx: 20 })
  const [clickOn, setClickOn] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [tapMode, setTapMode] = useState<TapMode>(null)
  const [tapCount, setTapCount] = useState(0)
  const taps = useRef<number[]>([])
  const tapFromLine = useRef<number | null>(null)
  const lastProblemMs = useRef<number | null>(null)
  const pan = useRef<Pan | null>(null)
  const pinch = useRef<{ startDistance: number; startView: TimelineView; centerX: number } | null>(null)
  const pointers = useRef(new Map<number, number>())
  const [recordingCues, setRecordingCues] = useState(false)
  /** The open cue window: a new cue at `timeMs`, or the cue `cueId` being edited. */
  const [cueDialog, setCueDialog] = useState<{ timeMs: number; cueId?: string } | null>(null)
  const lastLaneTap = useRef<{ at: number; x: number; lane: 'cue' | 'notes' } | null>(null)
  const [undoStack, setUndoStack] = useState<TimelineEditState[]>([])
  const [redoStack, setRedoStack] = useState<TimelineEditState[]>([])

  const editableGrid = beatGrid ?? NO_GRID
  const selectedBar = selection?.kind === 'bar' ? selection.bar : null
  const selectedLine = selection?.kind === 'line' ? selection.rawIndex : null
  const selectedCueId = selection?.kind === 'cue' ? selection.id : null
  const selectedNoteStart = selection?.kind === 'note' ? selection.start : null

  /** A time pulled onto the nearest detected drum hit within ONSET_MAGNET_MS. */
  function magnet(ms: number): number {
    if (!analysis) return ms
    let best = ms
    let bestDistance = ONSET_MAGNET_MS
    for (const onset of analysis.onsetsMs) {
      const distance = Math.abs(onset - ms)
      if (distance <= bestDistance) [best, bestDistance] = [onset, distance]
    }
    return best
  }

  const baseTimeline = useMemo(
    () => clickTimeline({ beatGrid, bpm, timeSignature, countInBars: countInEnabled ? countInBars : 0 }),
    [beatGrid, bpm, timeSignature, countInEnabled, countInBars],
  )
  /** A time pulled onto the nearest beat of the grid within LINE_SNAP_MS. */
  function snapToBeat(ms: number): number {
    let best = ms
    let bestDistance = LINE_SNAP_MS
    for (const beat of beatsBetween(baseTimeline, ms - LINE_SNAP_MS, ms + LINE_SNAP_MS)) {
      const distance = Math.abs(beat.timeMs - ms)
      if (distance <= bestDistance) [best, bestDistance] = [beat.timeMs, distance]
    }
    return best
  }

  // While a bar line or a text line is dragged, it is shown as it will be when dropped there.
  const dragMs = drag?.moved ? (drag.kind === 'bar' ? magnet : snapToBeat)(Math.max(0, xToTime(drag.x, view))) : null
  const previewGrid = drag?.kind === 'bar' && dragMs !== null ? setPoint(editableGrid, drag.bar, dragMs, timeSignature) : null
  const shownGrid = previewGrid ?? beatGrid
  const shownContent = drag?.kind === 'line' && dragMs !== null ? setLineTime(content, drag.rawIndex, dragMs) : content
  const shownCues = drag?.kind === 'cue' && dragMs !== null ? moveCue(cues, drag.id, dragMs) : cues

  const timeline = useMemo(
    () => (shownGrid === beatGrid ? baseTimeline : clickTimeline({ beatGrid: shownGrid, bpm, timeSignature, countInBars: countInEnabled ? countInBars : 0 })),
    [shownGrid, beatGrid, baseTimeline, bpm, timeSignature, countInEnabled, countInBars],
  )
  const stretches = useMemo(() => (shownGrid ? gridStretches(shownGrid, bpm, timeSignature) : []), [shownGrid, bpm, timeSignature])
  const lines = useMemo(() => timelineLines(shownContent), [shownContent])
  const notes = useMemo(() => timelineNotes(content), [content])
  const durationMs = analysis?.durationMs ?? (clock.duration > 0 ? clock.duration * 1000 : timeline.bar1Ms + 60000)
  const blocks = useMemo(() => partBlocks(lines, durationMs), [lines, durationMs])
  const countInStartMs = timeline.timeOfBeat(timeline.firstBeat)
  const minMs = Math.min(0, countInStartMs)
  const minimapRange = useMemo(() => ({ fromMs: minMs, toMs: durationMs }), [minMs, durationMs])
  const songBeats = useMemo(() => beatsBetween(timeline, 0, durationMs), [timeline, durationMs])
  const quality = useMemo(() => (analysis ? barQuality(songBeats, analysis.onsetsMs) : []), [songBeats, analysis])
  const untimedLines = tapLines(lines).filter((l) => l.timeMs === null).length

  // Track analysis (waveform + onsets): cached per track, computed once in a worker.
  useEffect(() => {
    if (!trackId) return
    let cancelled = false
    setAnalysisState('loading')
    loadTrackAnalysis(variantId, trackId)
      .then((result) => {
        if (cancelled) return
        setAnalysis(result)
        setAnalysisState(result ? 'idle' : 'error')
      })
      .catch(() => !cancelled && setAnalysisState('error'))
    return () => {
      cancelled = true
    }
  }, [variantId, trackId])

  // Fit the whole song into view - first on an estimate, again once the track's real length is
  // known (the waveform analysis or the audio element arrives later), unless the view has been
  // zoomed or scrolled by then. On the tablet the estimate showed only the first minute.
  const lengthKnown = analysis !== null || clock.duration > 0
  const fitted = useRef<{ view: TimelineView; real: boolean } | null>(null)
  useEffect(() => {
    if (box.width <= 0 || durationMs <= 0) return
    const current = fitted.current
    if (current && (current.real || !lengthKnown || current.view !== view)) return
    const next = { startMs: minMs, msPerPx: Math.max(1, (durationMs - minMs) / width) }
    fitted.current = { view: next, real: lengthKnown }
    setView(next)
  }, [box.width, width, durationMs, minMs, lengthKnown, view])

  const current: TimelineEditState = { beatGrid, bpm, chordProContent: content, cues }
  function commit(next: TimelineEditState) {
    setUndoStack((stack) => [...stack.slice(-49), current])
    setRedoStack([])
    onChange(next)
  }
  /** A new grid, with the song's bpm following its first stretch once there are two points. */
  function commitGrid(grid: BeatGrid | undefined, nextBpm = bpm) {
    const first = grid && grid.points.length >= 2 ? gridStretches(grid, nextBpm, timeSignature)[0] : undefined
    commit({ ...current, beatGrid: grid, bpm: first ? Math.round(first.bpm * 10) / 10 : nextBpm })
  }
  function commitText(nextContent: string) {
    if (nextContent !== content) commit({ ...current, chordProContent: nextContent })
  }
  function commitCues(nextCues: ShowCue[]) {
    commit({ ...current, cues: nextCues })
  }
  function undo() {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    setUndoStack(undoStack.slice(0, -1))
    setRedoStack([...redoStack, current])
    onChange(previous)
  }
  function redo() {
    const next = redoStack[redoStack.length - 1]
    if (!next) return
    setRedoStack(redoStack.slice(0, -1))
    setUndoStack([...undoStack, current])
    onChange(next)
  }

  // Click preview while the editor plays (clickEngine, the same one the show uses).
  const clickState = useRef({ timeline, playing: false })
  clickState.current = { timeline, playing: clock.isPlaying }
  useEffect(() => {
    if (!clickOn || !clock.isPlaying) return
    startClick(() => ({
      elapsedMs: clickState.current.playing ? useClockStore.getState().getElapsedMs() : null,
      timeline: clickState.current.timeline,
    }))
    return () => stopClick()
  }, [clickOn, clock.isPlaying])

  function seek(ms: number) {
    const audio = clock.audioProps.ref.current
    if (audio) audio.currentTime = Math.max(0, ms) / 1000
  }

  // Keep the playhead in view while playing.
  const playheadMs = clock.elapsedMs
  useEffect(() => {
    if (!clock.isPlaying) return
    const x = timeToX(playheadMs, view)
    if (x > width * 0.85 || x < 0) setView((v) => clampView({ ...v, startMs: playheadMs - width * 0.15 * v.msPerPx }, width, minMs, durationMs))
  }, [playheadMs, clock.isPlaying, view, width, minMs, durationMs])

  // Tapping ends when playback stops.
  useEffect(() => {
    if (tapMode && !clock.isPlaying && taps.current.length > 0) void finishTapping()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.isPlaying])

  // --- drawing ---
  useEffect(() => {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    const ink = cssVar('--sb-ink', '#e5e5e5')
    const faint = cssVar('--sb-ink-faint', '#a3a3a3')
    const accent = cssVar('--sb-accent', '#f59e0b')
    const stage = cssVar('--sb-stage', '#000000')
    const viewEndMs = xToTime(width, view)
    const activeBar = drag?.kind === 'bar' ? drag.bar : selectedBar
    const activeLine = drag?.kind === 'line' ? drag.rawIndex : selectedLine
    const activeBarMs = activeBar !== null ? timeline.timeOfBeat(timeline.barStartBeat(activeBar)) : null
    const activeLineMs = activeLine !== null ? (lines.find((l) => l.rawIndex === activeLine)?.timeMs ?? null) : null
    const activeCue = drag?.kind === 'cue' ? drag.id : selectedCueId
    const activeCueMs = activeCue !== null ? (shownCues.find((c) => c.id === activeCue)?.timeMs ?? null) : null
    const activeMs = activeBarMs ?? activeLineMs ?? activeCueMs

    const audio = audioCanvas.current?.getContext('2d')
    if (audio && audioCanvas.current) {
      audioCanvas.current.width = width * dpr
      audioCanvas.current.height = audioH * dpr
      audio.setTransform(dpr, 0, 0, dpr, 0, 0)
      audio.clearRect(0, 0, width, audioH)
      if (analysis) {
        const { min, max, bucketMs } = analysis.peaks
        const mid = audioH / 2
        audio.fillStyle = faint
        for (let x = 0; x < width; x++) {
          const from = Math.floor(xToTime(x, view) / bucketMs)
          const to = Math.max(from + 1, Math.floor(xToTime(x + 1, view) / bucketMs))
          let lo = 0, hi = 0
          for (let b = Math.max(0, from); b < Math.min(min.length, to); b++) {
            if (min[b]! < lo) lo = min[b]!
            if (max[b]! > hi) hi = max[b]!
          }
          if (hi > lo) audio.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid))
        }
      }
      if (timeline.firstBeat < 0) {
        audio.fillStyle = 'rgba(59,130,246,0.15)'
        const x0 = timeToX(countInStartMs, view)
        audio.fillRect(x0, 0, timeToX(timeline.bar1Ms, view) - x0, audioH)
      }
      // The dragged or selected bar line (or text line) runs on through the waveform, so it can be
      // laid exactly onto the hit there (Marco, 2026-09-28).
      if (activeMs !== null) {
        audio.fillStyle = accent
        audio.fillRect(timeToX(activeMs, view) - 1.5, 0, 3, audioH)
      }
    }

    // Labels sit on a patch of the lane background, so lines never run through the text.
    const labeller = (c: CanvasRenderingContext2D) => (text: string, x: number, y: number) => {
      const color = c.fillStyle
      const w = c.measureText(text).width
      c.fillStyle = stage
      c.fillRect(x - 2, y - 14, w + 4, 18)
      c.fillStyle = color
      c.fillText(text, x, y)
    }

    const g = gridCanvas.current?.getContext('2d')
    if (g && gridCanvas.current) {
      const h = SECTION_H + gridH
      gridCanvas.current.width = width * dpr
      gridCanvas.current.height = h * dpr
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const label = labeller(g)
      g.clearRect(0, 0, width, h)
      // Quality per bar, a band at the bottom of the grid lane.
      for (const bar of quality) {
        const x0 = timeToX(bar.startMs, view)
        const x1 = timeToX(bar.endMs, view)
        if (x1 < 0 || x0 > width) continue
        g.fillStyle = QUALITY_COLOR[bar.level]
        g.globalAlpha = 0.55
        g.fillRect(x0, h - 10, Math.max(1, x1 - x0 - 1), 10)
        g.globalAlpha = 1
      }
      // Beats and bars; the selected or dragged bar line in the accent colour.
      const firstVisible = Math.max(timeline.firstBeat, timeline.beatAtOrBefore(view.startMs))
      const period = timeline.periodAfter(firstVisible)
      const barMs = timeline.timeOfBeat(timeline.barStartBeat(timeline.barOf(firstVisible) + 1)) - timeline.timeOfBeat(timeline.barStartBeat(timeline.barOf(firstVisible)))
      const showBeats = period / view.msPerPx >= 12
      const labelEvery = barLabelEvery(barMs / view.msPerPx)
      // Zoomed far out, every bar line merged into a white block (2026-09-28): below
      // 12 px apart, only the numbered bars get a line.
      const everyBar = barMs / view.msPerPx >= 12
      for (const beat of beatsBetween(timeline, view.startMs, viewEndMs)) {
        const isBar = beat.beatInBar === 0
        const active = isBar && beat.bar === activeBar
        const numbered = isBar && beat.bar >= 1 && (beat.bar - 1) % labelEvery === 0
        if (!isBar && !showBeats) continue
        if (isBar && !everyBar && !numbered && !active) continue
        const x = timeToX(beat.timeMs, view)
        g.strokeStyle = active ? accent : isBar ? ink : faint
        g.lineWidth = active ? 4 : isBar ? 2 : 1
        g.beginPath()
        g.moveTo(x + 0.5, active ? 0 : SECTION_H + (isBar ? 0 : gridH * 0.45))
        g.lineTo(x + 0.5, active ? h : h - 12)
        g.stroke()
        if (numbered || active) {
          g.fillStyle = active ? accent : ink
          g.font = active ? 'bold 16px system-ui, sans-serif' : '14px system-ui, sans-serif'
          label(String(beat.bar), x + 4, SECTION_H + 16)
        }
      }
      // A selected text line or cue crosses the grid too.
      const crossingMs = activeLineMs ?? activeCueMs
      if (crossingMs !== null) {
        g.fillStyle = accent
        g.fillRect(timeToX(crossingMs, view) - 1.5, 0, 3, h)
      }
      // Alignment points as diamonds on their bar lines.
      g.fillStyle = accent
      for (const point of shownGrid?.points ?? []) {
        const x = timeToX(point.timeMs, view)
        if (x < -8 || x > width + 8) continue
        g.beginPath()
        g.moveTo(x, SECTION_H + gridH - 32)
        g.lineTo(x + 8, SECTION_H + gridH - 24)
        g.lineTo(x, SECTION_H + gridH - 16)
        g.lineTo(x - 8, SECTION_H + gridH - 24)
        g.fill()
      }
      // Tempo of each stretch along the top strip.
      g.fillStyle = 'rgba(255,255,255,0.06)'
      g.fillRect(0, 0, width, SECTION_H)
      g.fillStyle = ink
      g.font = 'bold 14px system-ui, sans-serif'
      // A label only where it has room - with points a bar or two apart they overlapped; the
      // selected bar line shows its tempo in the selection bar anyway.
      // Stretches starting left of the view share the left edge: only the one still playing there.
      const allLabels = stretches.length ? stretches : [{ fromMs: timeline.bar1Ms, bpm }]
      const firstOnScreen = allLabels.findIndex((st) => timeToX(st.fromMs, view) + 6 >= 4)
      const tempoLabels = allLabels.slice(Math.max(0, (firstOnScreen < 0 ? allLabels.length : firstOnScreen) - 1))
      let lastLabelX = -Infinity
      for (const stretch of tempoLabels) {
        const x = Math.max(4, timeToX(stretch.fromMs, view) + 6)
        if (x > width || x - lastLabelX < 100) continue
        lastLabelX = x
        label(`${stretch.bpm.toFixed(1)} BPM`, x, 18)
      }
    }

    const t = textCanvas.current?.getContext('2d')
    if (t && textCanvas.current) {
      const h = PARTS_H + textH
      textCanvas.current.width = width * dpr
      textCanvas.current.height = h * dpr
      t.setTransform(dpr, 0, 0, dpr, 0, 0)
      t.clearRect(0, 0, width, h)
      // Parts as coloured blocks with their name.
      t.font = 'bold 14px system-ui, sans-serif'
      const partsUsed: Array<[number, number]> = []
      const textUsed: Array<[number, number]> = []
      blocks.forEach((block, i) => {
        const x0 = Math.max(0, timeToX(block.startMs, view))
        const x1 = Math.min(width, timeToX(block.endMs, view))
        if (x1 <= 0 || x0 >= width) return
        partsUsed.push([x0, x1])
        t.fillStyle = PART_FILL[i % 2]!
        t.fillRect(x0, 2, Math.max(1, x1 - x0 - 2), PARTS_H - 4)
        const name = fitText(block.label ?? 'Teil', x1 - x0 - 12)
        if (name) {
          t.fillStyle = ink
          t.fillText(name, x0 + 6, PARTS_H - 9)
        }
      })
      // Lines: a marker at each time tag, the lyric beside it up to the next marker - wrapped
      // over as many rows as the lane holds, so more than a few words are readable.
      // In time order: a song's text order and time order can differ (a repeated chorus), and each
      // lyric may only use the room up to the next marker on the axis.
      const timed = lines.filter((l) => l.timeMs !== null).sort((a, b) => a.timeMs! - b.timeMs!)
      t.font = '15px system-ui, sans-serif'
      const rowH = 19
      const maxRows = Math.max(1, Math.floor((textH - 8) / rowH))
      timed.forEach((line, i) => {
        const x = timeToX(line.timeMs!, view)
        const nextX = i + 1 < timed.length ? timeToX(timed[i + 1]!.timeMs!, view) : width + 200
        if (nextX < 0 || x > width) return
        const active = line.rawIndex === activeLine
        t.fillStyle = active ? accent : faint
        t.fillRect(x - (active ? 1.5 : 1), PARTS_H, active ? 3 : 2, textH)
        t.fillStyle = active ? accent : ink
        const rows = wrapText(line.text, nextX - x - 12, maxRows, (row) => t.measureText(row).width)
        rows.forEach((row, r) => t.fillText(row, x + 6, PARTS_H + 22 + r * rowH))
        textUsed.push([x - 2, x + 6 + Math.max(0, ...rows.map((row) => t.measureText(row).width))])
      })
      drawLaneLabel(t, 'Parts', PARTS_H - 9, partsUsed, faint)
      drawLaneLabel(t, 'Text', PARTS_H + textH - 8, textUsed, faint)
      if (activeCueMs !== null) {
        t.fillStyle = accent
        t.fillRect(timeToX(activeCueMs, view) - 1.5, 0, 3, h)
      }
    }

    // Notes: comments and tab blocks at the time of their line. A dragged one is drawn where it
    // will land - on the line playing at the finger.
    const n = notesCanvas.current?.getContext('2d')
    if (n && notesCanvas.current) {
      notesCanvas.current.width = width * dpr
      notesCanvas.current.height = NOTES_H * dpr
      n.setTransform(dpr, 0, 0, dpr, 0, 0)
      n.clearRect(0, 0, width, NOTES_H)
      n.fillStyle = 'rgba(255,255,255,0.02)'
      n.fillRect(0, 0, width, NOTES_H)
      n.font = '14px system-ui, sans-serif'
      const dragTarget = drag?.kind === 'note' && dragMs !== null ? lineAtTime(content, dragMs)?.timeMs ?? null : null
      const placed = notes
        .map((note) => ({ note, timeMs: drag?.kind === 'note' && drag.start === note.start && dragTarget !== null ? dragTarget : note.timeMs }))
        .filter((p): p is { note: typeof p.note; timeMs: number } => p.timeMs !== null)
        .sort((a, b) => a.timeMs - b.timeMs)
      const activeNote = drag?.kind === 'note' ? drag.start : selectedNoteStart
      // Several notes on one line share its time: the later ones step down a row.
      let lastMs = -Infinity
      let row = 0
      const notesUsed: Array<[number, number]> = []
      placed.forEach(({ note, timeMs }, i) => {
        row = timeMs === lastMs ? row + 1 : 0
        lastMs = timeMs
        const x = timeToX(timeMs, view)
        const next = placed.slice(i + 1).find((p) => p.timeMs > timeMs)
        const nextX = next ? timeToX(next.timeMs, view) : width + 200
        if (nextX < 0 || x > width) return
        const active = note.start === activeNote
        n.fillStyle = active ? accent : NOTE_COLOR[note.kind]
        n.fillRect(x - (active ? 1.5 : 1), 0, active ? 3 : 2, NOTES_H)
        const who = note.targets ? ` · ${note.targets.join(', ')}` : ''
        const label = note.kind === 'tab' ? `Tab${note.text ? `: ${note.text}` : ''}${who}` : `${note.text ?? ''}${who}`
        const [text] = wrapText(label, nextX - x - 12, 1, (t) => n.measureText(t).width)
        notesUsed.push([x - 2, x + 6 + (text ? n.measureText(text).width : 0)])
        if (text) {
          n.fillStyle = active ? accent : ink
          n.fillText(text, x + 6, 17 + row * 18)
        }
      })
      if (placed.length === 0) {
        const hasTimedLine = lines.some((l) => l.timeMs !== null)
        drawLaneHint(
          n,
          hasTimedLine ? ['Notizen · Doppeltipp: Notiz hinzufügen', 'Doppeltipp: Notiz'] : ['Notizen hängen an Liedzeilen – erst „Zeilen tippen“', 'Notizen: erst Zeilen tippen'],
          width,
          NOTES_H,
          faint,
        )
      } else {
        drawLaneLabel(n, 'Notizen', NOTES_H - 8, notesUsed, faint)
      }
    }

    // Cues: a marker per cue in its device's colour, with device name and command beside it.
    const q = cueCanvas.current?.getContext('2d')
    if (q && cueCanvas.current) {
      cueCanvas.current.width = width * dpr
      cueCanvas.current.height = CUE_H * dpr
      q.setTransform(dpr, 0, 0, dpr, 0, 0)
      q.clearRect(0, 0, width, CUE_H)
      q.fillStyle = 'rgba(255,255,255,0.04)'
      q.fillRect(0, 0, width, CUE_H)
      q.font = '14px system-ui, sans-serif'
      const deviceIndex = new Map(logicalDevices.map((d, i) => [d.id, i]))
      const cuesUsed: Array<[number, number]> = []
      shownCues.forEach((cue, i) => {
        const x = timeToX(cue.timeMs, view)
        const nextX = i + 1 < shownCues.length ? timeToX(shownCues[i + 1]!.timeMs, view) : width + 200
        if (nextX < 0 || x > width) return
        const active = cue.id === activeCue
        const color = active ? accent : CUE_COLORS[(deviceIndex.get(cue.targetLogicalDeviceId) ?? 0) % CUE_COLORS.length]!
        q.fillStyle = color
        q.fillRect(x - 1.5, 0, 3, CUE_H)
        q.beginPath()
        q.arc(x, CUE_H / 2, active ? 8 : 6, 0, Math.PI * 2)
        q.fill()
        const device = logicalDevices.find((d) => d.id === cue.targetLogicalDeviceId)
        const [text] = wrapText(`${device?.name ?? '?'} · ${describeCue(cue, device?.capability)}`, nextX - x - 16, 1, (row) => q.measureText(row).width)
        cuesUsed.push([x - 8, x + 10 + (text ? q.measureText(text).width : 0)])
        if (text) {
          q.fillStyle = active ? accent : ink
          q.fillText(text, x + 10, CUE_H / 2 + 5)
        }
      })
      if (shownCues.length === 0) drawLaneHint(q, ['Cues · Doppeltipp: Cue hinzufügen', 'Doppeltipp: Cue'], width, CUE_H, faint)
      else drawLaneLabel(q, 'Cues', CUE_H - 6, cuesUsed, faint)
    }
  }, [width, audioH, gridH, textH, hiddenLanes, view, analysis, quality, timeline, stretches, shownGrid, bpm, countInStartMs, drag, selectedBar, selectedLine, selectedCueId, selectedNoteStart, lines, blocks, shownCues, logicalDevices, notes, content, dragMs])

  // --- pointer handling ---
  /** Pointer position inside the lanes. */
  function logical(e: { clientX: number; clientY: number; currentTarget: Element }): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /** The bar line within finger reach of `x` (bars only - beat lines are just a display). None
   * while bar lines are closer than two finger widths: zoomed out that far every touch would grab
   * one and the grid lane could never be scrolled - zoom in to align. */
  function barAt(x: number): number | null {
    const ms = xToTime(x, view)
    const reach = TOLERANCE_PX * view.msPerPx
    const near = timeline.barOf(Math.max(0, timeline.beatAtOrBefore(ms)))
    const barPx = (timeline.timeOfBeat(timeline.barStartBeat(near + 1)) - timeline.timeOfBeat(timeline.barStartBeat(near))) / view.msPerPx
    if (barPx < 2 * TOLERANCE_PX) return null
    let best: number | null = null
    let bestDistance = reach
    for (const beat of beatsBetween(timeline, ms - reach, ms + reach)) {
      if (beat.beatInBar !== 0 || beat.bar < 1) continue
      const distance = Math.abs(beat.timeMs - ms)
      if (distance <= bestDistance) [best, bestDistance] = [beat.bar, distance]
    }
    return best
  }

  /** The timed text line whose marker is within finger reach of `x`. */
  function lineAt(x: number): number | null {
    let best: number | null = null
    let bestDistance = TOLERANCE_PX
    for (const line of lines) {
      if (line.timeMs === null) continue
      const distance = Math.abs(timeToX(line.timeMs, view) - x)
      if (distance <= bestDistance) [best, bestDistance] = [line.rawIndex, distance]
    }
    return best
  }

  /** The note (comment or tab block) whose marker is within finger reach of `x`. */
  function noteAt(x: number): number | null {
    let best: number | null = null
    let bestDistance = TOLERANCE_PX
    for (const note of notes) {
      if (note.timeMs === null) continue
      const distance = Math.abs(timeToX(note.timeMs, view) - x)
      if (distance <= bestDistance) [best, bestDistance] = [note.start, distance]
    }
    return best
  }

  /** The cue whose marker is within finger reach of `x`. */
  function cueAt(x: number): string | null {
    let best: string | null = null
    let bestDistance = TOLERANCE_PX
    for (const cue of cues) {
      const distance = Math.abs(timeToX(cue.timeMs, view) - x)
      if (distance <= bestDistance) [best, bestDistance] = [cue.id, distance]
    }
    return best
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const { x, y } = logical(e)
    pointers.current.set(e.pointerId, x)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { startDistance: Math.abs(a! - b!) || 1, startView: view, centerX: (a! + b!) / 2 }
      pan.current = null
      setDrag(null)
      return
    }
    const base = { pointerId: e.pointerId, startX: x, x, moved: false }
    if (y >= cueTop) {
      const id = cueAt(x)
      if (id !== null) {
        setDrag({ ...base, kind: 'cue', id })
        return
      }
    } else if (y >= notesTop) {
      const start = noteAt(x)
      if (start !== null) {
        setDrag({ ...base, kind: 'note', start })
        return
      }
    } else if (y >= textTop + partsH) {
      const rawIndex = lineAt(x)
      if (rawIndex !== null) {
        setDrag({ ...base, kind: 'line', rawIndex })
        return
      }
    } else if (y >= gridTop && y < textTop) {
      const bar = barAt(x)
      if (bar !== null) {
        setDrag({ ...base, kind: 'bar', bar })
        return
      }
    }
    pan.current = { pointerId: e.pointerId, startX: x, startView: view, moved: false, lane: y >= cueTop ? 'cue' : y >= notesTop ? 'notes' : null }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const { x } = logical(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, x)
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.abs(a! - b!) || 1
      setView(clampView(zoomAround(pinch.current.startView, pinch.current.startDistance / distance, pinch.current.centerX), width, minMs, durationMs))
      return
    }
    if (drag && drag.pointerId === e.pointerId) {
      setDrag({ ...drag, x, moved: drag.moved || Math.abs(x - drag.startX) > MOVE_THRESHOLD_PX })
      return
    }
    const p = pan.current
    if (!p || p.pointerId !== e.pointerId) return
    p.moved = p.moved || Math.abs(x - p.startX) > MOVE_THRESHOLD_PX
    if (p.moved) setView(clampView({ ...p.startView, startMs: p.startView.startMs - (x - p.startX) * p.startView.msPerPx }, width, minMs, durationMs))
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null
      return
    }
    if (drag && drag.pointerId === e.pointerId) {
      if (drag.kind === 'bar') {
        setSelection({ kind: 'bar', bar: drag.bar })
        if (drag.moved && dragMs !== null) alignBar(drag.bar, dragMs)
      } else if (drag.kind === 'line') {
        setSelection({ kind: 'line', rawIndex: drag.rawIndex })
        if (drag.moved && dragMs !== null) commitText(setLineTime(content, drag.rawIndex, dragMs))
      } else if (drag.kind === 'cue') {
        setSelection({ kind: 'cue', id: drag.id })
        if (drag.moved && dragMs !== null) commitCues(moveCue(cues, drag.id, dragMs))
      } else if (drag.moved && dragMs !== null) {
        // A moved note lands on another line; its line number in the text changes with it.
        const moved = moveNote(content, drag.start, dragMs)
        commitText(moved.content)
        setSelection({ kind: 'note', start: moved.start })
      } else {
        setSelection({ kind: 'note', start: drag.start })
      }
      setDrag(null)
      return
    }
    const p = pan.current
    if (p && p.pointerId === e.pointerId && !p.moved) {
      // A double tap in the cue or notes lane adds a cue or a note there; a single tap moves the
      // playhead.
      const now = performance.now()
      const last = lastLaneTap.current
      if (p.lane && last && last.lane === p.lane && now - last.at < DOUBLE_TAP_MS && Math.abs(last.x - p.startX) < TOLERANCE_PX) {
        lastLaneTap.current = null
        const at = Math.max(0, xToTime(p.startX, view))
        if (p.lane === 'cue') openCueDialog(snapToBeat(at))
        else void addNoteAt(at)
      } else {
        lastLaneTap.current = p.lane ? { at: now, x: p.startX, lane: p.lane } : null
        setSelection(null)
        seek(xToTime(p.startX, view))
      }
    }
    pan.current = null
  }

  function onWheel(e: WheelEvent & { currentTarget: Element }) {
    const { x } = logical(e)
    if (e.ctrlKey || e.metaKey) {
      setView(clampView(zoomAround(view, Math.exp(e.deltaY * 0.002), x), width, minMs, durationMs))
    } else {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      setView(clampView({ ...view, startMs: view.startMs + delta * view.msPerPx }, width, minMs, durationMs))
    }
  }

  // Native, non-passive wheel listener (#323): React registers `wheel` as passive, so
  // preventDefault() in an onWheel prop is ignored - a horizontal touchpad swipe then also
  // triggered the browser's "Back" gesture (leaving the editor, losing unsaved edits) and
  // Ctrl+wheel / pinch zoomed the whole page as well as the timeline.
  const wheelRef = useRef(onWheel)
  wheelRef.current = onWheel
  useEffect(() => {
    if (!lanesEl) return
    const listener = (e: WheelEvent) => {
      e.preventDefault()
      wheelRef.current(e as WheelEvent & { currentTarget: Element })
    }
    lanesEl.addEventListener('wheel', listener, { passive: false })
    return () => lanesEl.removeEventListener('wheel', listener)
  }, [lanesEl])

  // --- grid edits ---
  /** Bar `bar` starts at `ms`: moves its point or adds one - refused past a neighbouring point. */
  function alignBar(bar: number, ms: number) {
    const next = setPoint(editableGrid, bar, ms, timeSignature)
    if (!next) {
      setNotice(`Takt ${bar} kann nicht dorthin: nicht vor 0:00 und nicht über einen Nachbarpunkt hinaus.`)
      return
    }
    setNotice(null)
    commitGrid(next)
  }

  /** "Takt 1 hier": bar 1 on the playhead (pulled onto a drum hit nearby). */
  function setBar1Here() {
    const ms = magnet(playheadMs)
    if (!beatGrid) {
      setNotice(null)
      commitGrid(newGrid(ms))
    } else alignBar(1, ms)
    setSelection({ kind: 'bar', bar: 1 })
  }

  // --- tapping: the tempo, or a stretch of lines ---
  function startTapping(mode: 'tempo' | 'lines', fromLine: number | null = selectedLine) {
    taps.current = []
    setTapCount(0)
    tapFromLine.current = mode === 'lines' ? (tapStartLine(lines, fromLine)?.rawIndex ?? null) : null
    if (mode === 'lines' && tapFromLine.current === null) {
      setNotice('Der Song hat keine Liedzeilen zum Tippen.')
      return
    }
    setNotice(null)
    setTapMode(mode)
  }

  /** Tapping ends: "Tempo tippen" sets the tempo from the slope through the taps, for the whole
   * song - a grid aligned at several bars gives them up (after asking), bar 1 stays. "Zeilen
   * tippen" stamps one line per tap from the start line on, as one undoable step. */
  async function finishTapping() {
    const mode = tapMode
    setTapMode(null)
    const tapped = taps.current
    taps.current = []
    setTapCount(0)
    if (mode === 'lines') {
      if (tapFromLine.current !== null && tapped.length > 0) {
        commitText(stampLines(content, tapFromLine.current, tapped))
        setNotice(`${tapped.length} ${tapped.length === 1 ? 'Zeile' : 'Zeilen'} gesetzt.`)
      }
      return
    }
    const tempo = tempoFromTaps(tapped)
    if (tempo === null) {
      setNotice('Mindestens 4 Schläge im Takt tippen.')
      return
    }
    let grid = beatGrid
    if (grid && grid.points.length > 1) {
      if (!(await confirm(`${tempo.toFixed(1)} BPM für den ganzen Song übernehmen? Die Ausrichtungspunkte nach Takt 1 werden entfernt. (Rückgängig möglich)`, { confirmLabel: 'Übernehmen' }))) return
      const first = [...grid.points].sort((a, b) => a.bar - b.bar)[0]!
      grid = { ...grid, points: [first] }
    }
    setNotice(`Tempo: ${tempo.toFixed(1)} BPM`)
    commitGrid(grid, tempo)
  }
  function tap() {
    taps.current.push(useClockStore.getState().getElapsedMs())
    setTapCount(taps.current.length)
  }
  /** "Letzte Zeile zurück": forget the last tap - its line is next again; playback goes on. */
  function undoTap() {
    taps.current.pop()
    setTapCount(taps.current.length)
  }
  /** "Zurück + 4 s": forget the last tap and replay from a little before it, to tap it again. */
  function undoTapAndRewind() {
    const last = taps.current.pop()
    setTapCount(taps.current.length)
    seek((last ?? useClockStore.getState().getElapsedMs()) - TAP_REWIND_MS)
  }
  // The line the next tap stamps (shown on the tap button).
  // Chord-only rows are skipped when tapping (#325).
  const tappable = tapMode === 'lines' ? tapLines(lines) : []
  const tapStartIndex = tapFromLine.current !== null ? tappable.findIndex((l) => l.rawIndex === tapFromLine.current) : -1
  const nextTapLine = tapStartIndex >= 0 ? tappable[tapStartIndex + tapCount] : undefined
  const prevTapLine = tapStartIndex >= 0 && tapCount > 0 ? tappable[tapStartIndex + tapCount - 1] : undefined
  const afterTapLine = tapStartIndex >= 0 ? tappable[tapStartIndex + tapCount + 1] : undefined

  // Opened via the text editor's "Tap-to-Sync" (#325): straight into "Zeilen tippen".
  useEffect(() => {
    if (!startLineTapping) return
    startTapping('lines', null)
    onLineTappingStarted?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startLineTapping])

  async function detectGrid() {
    if (!onDetectGrid) return
    if (beatGrid && !(await confirm('Raster durch die automatische Erkennung ersetzen? (Rückgängig möglich)', { confirmLabel: 'Ersetzen' }))) return
    setDetecting(true)
    setNotice(null)
    try {
      const result = await onDetectGrid()
      if (!result) {
        setNotice('Keine Schläge erkannt.')
        return
      }
      commit({ ...current, ...result })
    } catch {
      setNotice('Analyse fehlgeschlagen.')
    } finally {
      setDetecting(false)
    }
  }

  async function clearGrid() {
    if (!(await confirm('Klick-Raster löschen? Der Klick läuft danach ab 0:00 im eingetragenen Tempo. (Rückgängig möglich)', { confirmLabel: 'Löschen', danger: true }))) return
    setSelection(null)
    commit({ ...current, beatGrid: undefined })
  }

  async function editMeter(bar: number) {
    const existing = shownGrid?.meters.find((m) => m.bar === bar)?.timeSignature ?? ''
    const result = await promptFields(`Taktart ab Takt ${bar}`, [{ key: 'ts', label: 'Taktart (leer = wie davor)', defaultValue: existing }], 'Übernehmen')
    if (!result) return
    const ts = (result.ts ?? '').trim()
    if (ts && !/^\d+\/\d+$/.test(ts)) {
      setNotice('Taktart wie 4/4, 3/4 oder 6/8 eingeben.')
      return
    }
    commitGrid(setMeter(editableGrid, bar, ts || null))
  }

  // --- cues ---
  function openCueDialog(timeMs: number, cueId?: string) {
    if (logicalDevices.length === 0) {
      setNotice('Noch keine Geräte angelegt – Cues brauchen ein Ziel-Gerät (Einstellungen → Geräte).')
      return
    }
    setNotice(null)
    setCueDialog({ timeMs, cueId })
  }

  function submitCue(content: CueContent) {
    if (!cueDialog) return
    if (cueDialog.cueId) {
      commitCues(updateCue(cues, cueDialog.cueId, content))
    } else {
      const { cues: next, id } = addCue(cues, { ...content, timeMs: cueDialog.timeMs })
      commitCues(next)
      setSelection({ kind: 'cue', id })
    }
    setCueDialog(null)
  }

  // --- notes ---
  async function addNoteAt(timeMs: number) {
    const line = lineAtTime(content, timeMs)
    if (!line) {
      setNotice('Notizen hängen an Liedzeilen – erst Zeilen mit Zeit setzen („Zeilen tippen“).')
      return
    }
    const result = await promptFields(`Notiz vor „${fitText(line.text, 200)}“`, [{ key: 'text', label: 'Notiz (z.B. „Solo ab 8. Bund“)' }], 'Übernehmen')
    const text = result?.text?.trim()
    if (!text) return
    const next = insertComment(content, timeMs, text)
    commitText(next)
    setSelection({ kind: 'note', start: line.rawIndex })
  }

  async function editNoteText(start: number, kind: 'comment' | 'tab', current: string | null) {
    const result = await promptFields(kind === 'tab' ? 'Tab-Name' : 'Notiz', [{ key: 'text', label: kind === 'tab' ? 'Name (leer = ohne)' : 'Text', defaultValue: current ?? '' }], 'Übernehmen')
    if (!result) return
    const text = (result.text ?? '').trim()
    if (kind === 'comment' && !text) return
    commitText(setNoteText(content, start, text))
  }

  function startRecordingCues() {
    clock.audioProps.ref.current?.pause()
    setRecordingCues(true)
  }

  /** "Nächste Problemstelle": the next red (else orange) bar after the playhead, zoomed so a few
   * bars fill the view, the playhead on it and its bar line selected - ready to listen and align. */
  function jumpToNextProblem() {
    const from = lastProblemMs.current !== null && Math.abs(playheadMs - lastProblemMs.current) < 1000 ? lastProblemMs.current : playheadMs
    const bar = nextProblemBar(quality, from)
    if (!bar) {
      setNotice('Keine Problemstellen - alle Takte sitzen auf den Drum-Hits.')
      return
    }
    setNotice(null)
    lastProblemMs.current = bar.startMs
    const msPerPx = Math.min(view.msPerPx, Math.max(1, ((bar.endMs - bar.startMs) * 4) / width))
    setView(clampView({ msPerPx, startMs: bar.startMs - width * 0.25 * msPerPx }, width, minMs, durationMs))
    setSelection({ kind: 'bar', bar: timeline.barOf(timeline.beatAtOrBefore(bar.startMs + 1)) })
    seek(bar.startMs)
  }

  // The selection: a bar line (where, point or not, tempo) or a text line (where, what).
  const selectedBarMs = selectedBar !== null ? timeline.timeOfBeat(timeline.barStartBeat(selectedBar)) : null
  const selectedPoint = selectedBar !== null ? shownGrid?.points.find((p) => p.bar === selectedBar) : undefined
  const selectedTempo = selectedBar !== null ? 60000 / timeline.periodAfter(timeline.barStartBeat(selectedBar)) : null
  const selectedLineInfo = selectedLine !== null ? lines.find((l) => l.rawIndex === selectedLine) : undefined
  const selectedCue = selectedCueId !== null ? cues.find((c) => c.id === selectedCueId) : undefined
  const selectedCueDevice = selectedCue ? logicalDevices.find((d) => d.id === selectedCue.targetLogicalDeviceId) : undefined
  const selectedNote = selectedNoteStart !== null ? notes.find((note) => note.start === selectedNoteStart) : undefined

  // --- playhead quick actions (#326): the playhead as the target of an edit ---
  /** Where the playhead is right now - the same clock tapping reads, exact while playing too. */
  function playheadNow(): number {
    return Math.round(useClockStore.getState().getElapsedMs())
  }

  /** "Zum Abspielkopf": the selected bar line, lyric line, cue or note moves to the playhead. */
  function moveSelectionToPlayhead() {
    const ms = playheadNow()
    if (selectedBar !== null) {
      alignBar(selectedBar, ms)
    } else if (selectedLineInfo) {
      const { minMs: lo, maxMs: hi } = lineTimeBounds(lines, selectedLineInfo.rawIndex)
      if (ms < lo || ms > hi) {
        setNotice(`Die Zeile kann nur zwischen ihren Nachbarn liegen (${formatTimelineTime(lo)} bis ${Number.isFinite(hi) ? formatTimelineTime(hi) : 'Ende'}).`)
        return
      }
      setNotice(null)
      commitText(setLineTime(content, selectedLineInfo.rawIndex, ms))
    } else if (selectedCue) {
      commitCues(moveCue(cues, selectedCue.id, ms))
    } else if (selectedNote) {
      // A note belongs to a line: it moves to the line playing at the playhead.
      const moved = moveNote(content, selectedNote.start, ms)
      commitText(moved.content)
      setSelection({ kind: 'note', start: moved.start })
    }
  }

  /** Moves the selected text line by `deltaMs` (kept between its neighbours). */
  function nudgeLine(deltaMs: number) {
    if (!selectedLineInfo || selectedLineInfo.timeMs === null) return
    const { minMs: lo, maxMs: hi } = lineTimeBounds(lines, selectedLineInfo.rawIndex)
    const ms = Math.min(Math.max(selectedLineInfo.timeMs + deltaMs, lo), hi)
    commitText(setLineTime(content, selectedLineInfo.rawIndex, ms))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // While tapping, Space taps (it would otherwise toggle playback too) - from anywhere in the
    // timeline, not just the container; holding it down must not rapid-fire through lines.
    if (tapMode && e.key === ' ') {
      e.preventDefault()
      if (e.repeat) return
      if (clock.isPlaying) tap()
      else clock.togglePlay()
      return
    }
    if (tapMode === 'lines' && (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'Backspace')) {
      e.preventDefault()
      if (e.key === 'ArrowUp') undoTap()
      else undoTapAndRewind()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (e.key === ' ' && e.target === e.currentTarget) {
      e.preventDefault()
      clock.togglePlay()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const sign = e.key === 'ArrowLeft' ? -1 : 1
      if (selectedBar !== null) {
        e.preventDefault()
        alignBar(selectedBar, selectedBarMs! + sign * 10)
      } else if (selectedLineInfo) {
        e.preventDefault()
        nudgeLine(sign * 50)
      } else if (selectedCue) {
        e.preventDefault()
        commitCues(moveCue(cues, selectedCue.id, selectedCue.timeMs + sign * 50))
      }
    }
  }

  const playheadX = timeToX(playheadMs, view)
  const button = 'min-h-12 rounded-sb-sm bg-control-strong px-3 text-sm font-semibold text-ink hover:bg-control-strong-hover disabled:opacity-40'
  const toggle = (on: boolean) => `${button} ${on ? '!bg-accent !text-accent-ink' : ''}`
  const iconButton = 'flex min-h-12 min-w-12 items-center justify-center rounded-sb-sm bg-control-strong px-3 text-ink hover:bg-control-strong-hover disabled:opacity-40'
  const gridHint = !beatGrid
    ? 'Auf den ersten Schlag in der Wellenform tippen, dann „Takt 1 hier“ – danach „Tempo tippen“.'
    : 'Wo das Raster danebenliegt: hineinzoomen und den Taktstrich auf den Schlag in der Wellenform ziehen.'
  const hint = untimedLines > 0 ? `${gridHint} · ${untimedLines} ${untimedLines === 1 ? 'Zeile' : 'Zeilen'} noch ohne Zeit – „Zeilen tippen“.` : gridHint

  if (recordingCues) {
    return (
      <div className={`flex flex-col gap-3 ${fill ? 'h-full min-h-0 overflow-y-auto' : ''}`}>
        <CueRecorder
          trackSrc={trackSrc}
          chordProContent={content}
          onComplete={(recorded) => {
            setRecordingCues(false)
            if (recorded.length > 0) {
              commitCues(mergeCues(cues, recorded))
              setNotice(`${recorded.length} ${recorded.length === 1 ? 'Cue' : 'Cues'} aufgenommen.`)
            }
          }}
          onCancel={() => setRecordingCues(false)}
        />
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-3 ${fill ? 'h-full min-h-0' : ''}`} onKeyDown={onKeyDown} tabIndex={0} aria-label="Timeline">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={clock.togglePlay} disabled={!trackSrc} aria-label={clock.isPlaying ? 'Pause' : 'Abspielen'}>
          {clock.isPlaying ? '❚❚' : '▶'}
        </button>
        <span className="min-w-20 font-bold tabular-nums">{formatTimelineTime(playheadMs)}</span>
        <button type="button" className={button} aria-label="Herauszoomen" onClick={() => setView(clampView(zoomAround(view, 1.6, width / 2), width, minMs, durationMs))}>
          −
        </button>
        <button type="button" className={button} aria-label="Hineinzoomen" onClick={() => setView(clampView(zoomAround(view, 1 / 1.6, width / 2), width, minMs, durationMs))}>
          +
        </button>
        <button type="button" className={toggle(clickOn)} aria-pressed={clickOn} onClick={() => setClickOn(!clickOn)}>
          Klick
        </button>
        <button type="button" className={iconButton} onClick={undo} disabled={undoStack.length === 0} aria-label="Rückgängig">
          <UndoIcon />
        </button>
        <button type="button" className={iconButton} onClick={redo} disabled={redoStack.length === 0} aria-label="Wiederholen">
          <UndoIcon mirrored />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={setBar1Here} disabled={tapMode !== null}>
          Takt 1 hier
        </button>
        <button type="button" className={toggle(tapMode === 'tempo')} aria-pressed={tapMode === 'tempo'} disabled={!trackSrc || tapMode === 'lines'} onClick={() => (tapMode === 'tempo' ? void finishTapping() : startTapping('tempo'))}>
          {tapMode === 'tempo' ? `Tippen beenden (${tapCount})` : 'Tempo tippen'}
        </button>
        <button type="button" className={toggle(tapMode === 'lines')} aria-pressed={tapMode === 'lines'} disabled={!trackSrc || tapMode === 'tempo'} onClick={() => (tapMode === 'lines' ? void finishTapping() : startTapping('lines'))}>
          {tapMode === 'lines' ? `Tippen beenden (${tapCount})` : 'Zeilen tippen'}
        </button>
        {onDetectGrid && (
          <button type="button" className={button} disabled={!trackSrc || detecting || tapMode !== null} onClick={() => void detectGrid()}>
            {detecting ? 'Analysiere…' : 'Track analysieren'}
          </button>
        )}
        <button type="button" className={button} disabled={quality.length === 0} onClick={jumpToNextProblem}>
          Nächste Problemstelle
        </button>
        <button type="button" className={button} disabled={tapMode !== null} onClick={() => openCueDialog(playheadNow())}>
          Cue am Abspielkopf
        </button>
        <button type="button" className={toggle(lanesMenuOpen)} aria-pressed={lanesMenuOpen} onClick={() => setLanesMenuOpen((open) => !open)}>
          Spuren{hiddenLanes.size > 0 ? ` (${TIMELINE_LANES.length - hiddenLanes.size}/${TIMELINE_LANES.length})` : ''}
        </button>
        <button type="button" className={button} disabled={!trackSrc || tapMode !== null} onClick={startRecordingCues}>
          Cues aufnehmen
        </button>
        <button type="button" className={button} disabled={!beatGrid || tapMode !== null} onClick={() => void clearGrid()}>
          Raster löschen
        </button>
      </div>

      {lanesMenuOpen && (
        <div className="flex flex-wrap items-center gap-2 rounded-sb bg-control p-2" role="group" aria-label="Spuren">
          {TIMELINE_LANES.map((lane) => (
            <button
              key={lane}
              type="button"
              className={toggle(!hiddenLanes.has(lane))}
              aria-pressed={!hiddenLanes.has(lane)}
              // The last visible lane stays - an empty timeline would show nothing to work on.
              disabled={!hiddenLanes.has(lane) && hiddenLanes.size === TIMELINE_LANES.length - 1}
              onClick={() => toggleLane(lane)}
            >
              {LANE_NAME[lane]}
            </button>
          ))}
          <span className="text-sm text-ink-faint">Gilt für dieses Gerät.</span>
        </div>
      )}
      <p className="text-sm text-ink-soft" role="status">
        {notice ?? hint}
      </p>

      {!trackId && <p className="text-sm text-ink-faint">Kein Track angehängt - die Timeline zeigt nur das Raster.</p>}
      {analysisState === 'loading' && <p className="text-sm text-ink-faint">Wellenform wird berechnet…</p>}
      {analysisState === 'error' && <p className="text-sm text-amber-500">Track auf diesem Gerät nicht verfügbar - keine Wellenform.</p>}

      <TimelineMinimap
        width={width}
        peaks={analysis?.peaks ?? null}
        range={minimapRange}
        view={view}
        viewSpanMs={width * view.msPerPx}
        blocks={blocks}
        playheadMs={playheadMs}
        onPan={(startMs) => setView((v) => clampView({ ...v, startMs }, width, minMs, durationMs))}
      />

      <div
        ref={boxRef}
        className={`relative w-full select-none overflow-hidden rounded-sb border border-line bg-stage ${fill ? 'min-h-48 flex-1' : ''}`}
        style={{ height: fill ? undefined : lanesH, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="timeline-lanes"
      >
        {!hiddenLanes.has('audio') && <canvas ref={audioCanvas} className="absolute left-0 top-0" style={{ width, height: audioH }} />}
        {!hiddenLanes.has('grid') && <canvas ref={gridCanvas} className="absolute" style={{ left: 0, top: gridTop, width, height: SECTION_H + gridH }} />}
        {!hiddenLanes.has('text') && <canvas ref={textCanvas} className="absolute" style={{ left: 0, top: textTop, width, height: PARTS_H + textH }} data-testid="timeline-text" />}
        {!hiddenLanes.has('notes') && <canvas ref={notesCanvas} className="absolute" style={{ left: 0, top: notesTop, width, height: NOTES_H }} data-testid="timeline-notes" />}
        {!hiddenLanes.has('cues') && <canvas ref={cueCanvas} className="absolute" style={{ left: 0, top: cueTop, width, height: CUE_H }} data-testid="timeline-cues" />}
        {playheadX >= 0 && playheadX <= width && (
          <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-red-500" style={{ left: playheadX }} data-testid="timeline-playhead" />
        )}
      </div>

      {tapMode === 'lines' && (
        <div className="flex flex-col gap-2 rounded-sb bg-control p-2" data-testid="tap-lines-panel">
          <div className="flex flex-col gap-1 px-2 text-base">
            <span className="truncate text-ink-faint">{prevTapLine ? `✓ ${prevTapLine.text}` : ' '}</span>
            <span className="truncate text-lg font-bold text-accent">{nextTapLine ? `→ ${nextTapLine.text}` : 'Alle Zeilen gesetzt – Tippen beenden'}</span>
            <span className="truncate text-ink-faint">{afterTapLine ? afterTapLine.text : ' '}</span>
          </div>
          <button type="button" className="h-touch-primary rounded-sb bg-accent px-4 text-xl font-black text-accent-ink" onPointerDown={() => clock.isPlaying && tap()}>
            {clock.isPlaying ? (nextTapLine ? 'TIPP' : 'Fertig') : 'Abspielen, dann zu jeder Zeile tippen'}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button} disabled={tapCount === 0} onClick={undoTap}>
              Letzte Zeile zurück
            </button>
            <button type="button" className={button} disabled={!clock.isPlaying} onClick={undoTapAndRewind}>
              Zurück + 4 s
            </button>
            <span className="text-sm text-ink-faint">Tastatur: Leertaste tippen · ↑ letzte zurück · ← zurück + 4 s</span>
          </div>
        </div>
      )}
      {tapMode === 'tempo' && (
        <button type="button" className="h-touch-primary rounded-sb bg-accent px-4 text-xl font-black text-accent-ink" onPointerDown={() => clock.isPlaying && tap()}>
          {clock.isPlaying ? `TIPP (${tapCount})` : 'Abspielen, dann im Takt tippen'}
        </button>
      )}

      {selectedBar !== null && selectedBarMs !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-sb bg-control p-2">
          <span className="font-semibold">
            Takt {selectedBar} · {formatTimelineTime(selectedBarMs)} · {selectedTempo!.toFixed(1)} BPM{selectedPoint ? ' · Ausrichtungspunkt' : ''}
          </span>
          <button type="button" className={button} onClick={() => alignBar(selectedBar, selectedBarMs - 10)}>
            −10 ms
          </button>
          <button type="button" className={button} onClick={() => alignBar(selectedBar, selectedBarMs + 10)}>
            +10 ms
          </button>
          <button type="button" className={button} onClick={moveSelectionToPlayhead}>
            Zum Abspielkopf
          </button>
          {selectedPoint && (shownGrid?.points.length ?? 0) > 1 && (
            <button type="button" className={button} onClick={() => commitGrid(removePoint(editableGrid, selectedPoint.id))}>
              Punkt entfernen
            </button>
          )}
          {selectedBar >= 2 && (
            <button type="button" className={button} onClick={() => void editMeter(selectedBar)}>
              Taktart ab hier
            </button>
          )}
        </div>
      )}

      {selectedLineInfo && (
        <div className="flex flex-wrap items-center gap-2 rounded-sb bg-control p-2">
          <span className="font-semibold">
            „{fitText(selectedLineInfo.text, 320)}“ · {selectedLineInfo.timeMs !== null ? formatTimelineTime(selectedLineInfo.timeMs) : 'ohne Zeit'}
          </span>
          <button type="button" className={button} disabled={selectedLineInfo.timeMs === null} onClick={() => nudgeLine(-50)}>
            −50 ms
          </button>
          <button type="button" className={button} disabled={selectedLineInfo.timeMs === null} onClick={() => nudgeLine(50)}>
            +50 ms
          </button>
          <button type="button" className={button} onClick={moveSelectionToPlayhead}>
            Zum Abspielkopf
          </button>
          <button type="button" className={button} disabled={selectedLineInfo.timeMs === null} onClick={() => commitText(setLineTime(content, selectedLineInfo.rawIndex, null))}>
            Zeit entfernen
          </button>
          <button type="button" className={button} disabled={!trackSrc || tapMode !== null} onClick={() => startTapping('lines', selectedLineInfo.rawIndex)}>
            Zeilen tippen ab hier
          </button>
        </div>
      )}

      {selectedCue && (
        <div className="flex flex-wrap items-center gap-2 rounded-sb bg-control p-2">
          <span className="font-semibold">
            {selectedCueDevice?.name ?? 'Unbekanntes Gerät'} · {describeCue(selectedCue, selectedCueDevice?.capability)} · {formatTimelineTime(selectedCue.timeMs)}
          </span>
          <button type="button" className={button} onClick={() => commitCues(moveCue(cues, selectedCue.id, selectedCue.timeMs - 50))}>
            −50 ms
          </button>
          <button type="button" className={button} onClick={() => commitCues(moveCue(cues, selectedCue.id, selectedCue.timeMs + 50))}>
            +50 ms
          </button>
          <button type="button" className={button} onClick={moveSelectionToPlayhead}>
            Zum Abspielkopf
          </button>
          <button type="button" className={button} onClick={() => openCueDialog(selectedCue.timeMs, selectedCue.id)}>
            Bearbeiten
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              commitCues(removeCue(cues, selectedCue.id))
              setSelection(null)
            }}
          >
            Entfernen
          </button>
        </div>
      )}

      {selectedNote && (
        <div className="flex flex-col gap-2 rounded-sb bg-control p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">
              {selectedNote.kind === 'tab' ? `Tab${selectedNote.text ? `: ${selectedNote.text}` : ''}` : `„${selectedNote.text ?? ''}“`}
              {selectedNote.timeMs !== null ? ` · ${formatTimelineTime(selectedNote.timeMs)}` : ''}
            </span>
            <button type="button" className={button} onClick={moveSelectionToPlayhead}>
              Zum Abspielkopf
            </button>
            <button type="button" className={button} onClick={() => void editNoteText(selectedNote.start, selectedNote.kind, selectedNote.text)}>
              {selectedNote.kind === 'tab' ? 'Name ändern' : 'Text ändern'}
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                commitText(removeNote(content, selectedNote.start))
                setSelection(null)
              }}
            >
              Entfernen
            </button>
          </div>
          <TargetPicker profiles={profiles} targets={selectedNote.targets} onChange={(targets) => commitText(setNoteTargets(content, selectedNote.start, targets))} />
        </div>
      )}

      {cueDialog && (
        <CueDialog
          title={cueDialog.cueId ? 'Cue bearbeiten' : `Cue bei ${formatTimelineTime(cueDialog.timeMs)}`}
          devices={logicalDevices}
          initial={cues.find((c) => c.id === cueDialog.cueId)}
          onSubmit={submitCue}
          onCancel={() => setCueDialog(null)}
        />
      )}

      <audio {...clock.audioProps} className="hidden" />
    </div>
  )
}
