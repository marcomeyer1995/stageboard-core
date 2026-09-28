import { useEffect, useMemo, useRef, useState } from 'react'
import type { BeatGrid } from 'shared-types'
import { beatsBetween, clickTimeline, gridStretches, newGrid, removePoint, setMeter, setPoint, tempoFromTaps } from '../../lib/beatGrid'
import { startClick, stopClick } from '../../lib/clickEngine'
import {
  barLabelEvery,
  barQuality,
  clampView,
  formatTimelineTime,
  nextProblemBar,
  timeToX,
  tokenColor,
  xToTime,
  zoomAround,
  type TimelineView,
} from '../../lib/timeline'
import { loadTrackAnalysis, type TrackAnalysis } from '../../lib/trackAnalysis'
import { useElementSize } from '../../lib/useElementSize'
import { useTrackClock } from '../../lib/useTrackClock'
import { useClockStore } from '../../store/useClockStore'
import { useDialogStore } from '../../store/useDialogStore'

/** What the timeline changes on the song: its grid, and its bpm (kept equal to the grid's first
 * stretch, so count-in and tempo displays agree with the click). */
export interface TimelineGridState {
  beatGrid: BeatGrid | undefined
  bpm: number
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
  onChange: (next: TimelineGridState) => void
  /** Automatic beat detection turned into a grid (the song editor's "Track analysieren") -
   * applied here as one undoable step. Null: nothing usable detected. */
  onDetectGrid?: () => Promise<{ bpm: number; beatGrid: BeatGrid } | null>
  /** Full screen (docs/14): the lanes take all the height the parent gives the component. */
  fill?: boolean
}

/** Lane heights in the compact layout; full screen (`fill`) splits the available height. */
const DEFAULT_AUDIO_H = 96
const SECTION_H = 26
const DEFAULT_GRID_H = 84
const TOLERANCE_PX = 24
const MOVE_THRESHOLD_PX = 6
/** A bar line dropped (or set) within this distance of a detected drum hit lands on it. */
const ONSET_MAGNET_MS = 40
/** Stand-in for a song without a grid of its own: bar 1 at 0:00 (what playback assumes too). */
const NO_GRID: BeatGrid = { points: [{ id: 'bar-1', bar: 1, timeMs: 0 }], meters: [] }

const QUALITY_COLOR = { good: '#16a34a', ok: '#d97706', poor: '#dc2626', quiet: '#52525b' } as const

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

type Pan = { pointerId: number; startX: number; startView: TimelineView; moved: boolean }
type BarDrag = { pointerId: number; bar: number; startX: number; x: number; moved: boolean }

/**
 * The timeline editor (docs/14 §5a): the track's waveform and the click grid on one time axis -
 * a rigid ruler aligned to the track at a few bars. Set bar 1 on the first hit, tap the tempo,
 * then drag a bar line onto its hit wherever the ruler drifts: that bar becomes an alignment point
 * and only the bars between its neighbouring points move. Works on the song editor's draft;
 * nothing is written until the song editor saves. Touch and mouse alike: drag a bar line = align
 * it, swipe elsewhere = scroll, tap = move the playhead (or select a bar line), pinch /
 * Ctrl+wheel = zoom.
 */
export function TimelineEditor(props: TimelineEditorProps) {
  const { variantId, trackId, trackSrc, beatGrid, bpm, timeSignature, countInEnabled, countInBars, onChange, onDetectGrid, fill = false } = props
  const clock = useTrackClock(trackSrc)
  const [boxRef, box] = useElementSize()
  // Portrait (full screen, taller than wide): time runs downwards and the lanes become columns -
  // more of the song in view, and it reads top to bottom like the Prompter (Marco, 2026-09-27).
  // All drawing and hit-testing below works in "along the time axis / across the lanes"
  // coordinates: `width` is the time axis' length, the lane sizes are across it; only the canvas
  // transform, the pointer coordinates and the playhead swap for the vertical layout.
  const vertical = fill && box.height > box.width && box.width > 0
  const width = Math.max(1, vertical ? box.height : box.width)
  const crossLen = vertical ? box.width : box.height
  const lanesH = fill && crossLen > 0 ? crossLen : DEFAULT_AUDIO_H + SECTION_H + DEFAULT_GRID_H
  const audioH = fill ? Math.round((lanesH - SECTION_H) * 0.45) : DEFAULT_AUDIO_H
  const gridH = lanesH - audioH - SECTION_H
  const audioCanvas = useRef<HTMLCanvasElement>(null)
  const gridCanvas = useRef<HTMLCanvasElement>(null)
  const confirm = useDialogStore((state) => state.confirm)
  const promptFields = useDialogStore((state) => state.promptFields)

  const [analysis, setAnalysis] = useState<TrackAnalysis | null>(null)
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [view, setView] = useState<TimelineView>({ startMs: 0, msPerPx: 20 })
  const [clickOn, setClickOn] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedBar, setSelectedBar] = useState<number | null>(null)
  const [drag, setDrag] = useState<BarDrag | null>(null)
  const [tapping, setTapping] = useState(false)
  const [tapCount, setTapCount] = useState(0)
  const taps = useRef<number[]>([])
  const lastProblemMs = useRef<number | null>(null)
  const pan = useRef<Pan | null>(null)
  const pinch = useRef<{ startDistance: number; startView: TimelineView; centerX: number } | null>(null)
  const pointers = useRef(new Map<number, number>())
  const [undoStack, setUndoStack] = useState<TimelineGridState[]>([])
  const [redoStack, setRedoStack] = useState<TimelineGridState[]>([])

  const editableGrid = beatGrid ?? NO_GRID

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

  // While a bar line is dragged, the grid is shown as it will be when dropped there.
  const dragMs = drag?.moved ? magnet(xToTime(drag.x, view)) : null
  const previewGrid = drag && dragMs !== null ? setPoint(editableGrid, drag.bar, dragMs, timeSignature) : null
  const shownGrid = previewGrid ?? beatGrid

  const timeline = useMemo(
    () => clickTimeline({ beatGrid: shownGrid, bpm, timeSignature, countInBars: countInEnabled ? countInBars : 0 }),
    [shownGrid, bpm, timeSignature, countInEnabled, countInBars],
  )
  const stretches = useMemo(() => (shownGrid ? gridStretches(shownGrid, bpm, timeSignature) : []), [shownGrid, bpm, timeSignature])
  const durationMs = analysis?.durationMs ?? (clock.duration > 0 ? clock.duration * 1000 : timeline.bar1Ms + 60000)
  const countInStartMs = timeline.timeOfBeat(timeline.firstBeat)
  const minMs = Math.min(0, countInStartMs)
  const songBeats = useMemo(() => beatsBetween(timeline, 0, durationMs), [timeline, durationMs])
  const quality = useMemo(() => (analysis ? barQuality(songBeats, analysis.onsetsMs) : []), [songBeats, analysis])

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

  function commit(next: TimelineGridState) {
    setUndoStack((stack) => [...stack.slice(-49), { beatGrid, bpm }])
    setRedoStack([])
    onChange(next)
  }
  /** A new grid, with the song's bpm following its first stretch once there are two points. */
  function commitGrid(grid: BeatGrid | undefined, nextBpm = bpm) {
    const first = grid && grid.points.length >= 2 ? gridStretches(grid, nextBpm, timeSignature)[0] : undefined
    commit({ beatGrid: grid, bpm: first ? Math.round(first.bpm * 10) / 10 : nextBpm })
  }
  function undo() {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    setUndoStack(undoStack.slice(0, -1))
    setRedoStack([...redoStack, { beatGrid, bpm }])
    onChange(previous)
  }
  function redo() {
    const next = redoStack[redoStack.length - 1]
    if (!next) return
    setRedoStack(redoStack.slice(0, -1))
    setUndoStack([...undoStack, { beatGrid, bpm }])
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
    if (tapping && !clock.isPlaying && taps.current.length > 0) void finishTapping()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.isPlaying])

  // --- drawing ---
  useEffect(() => {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    const ink = cssVar('--sb-ink', '#e5e5e5')
    const faint = cssVar('--sb-ink-faint', '#a3a3a3')
    const accent = cssVar('--sb-accent', '#f59e0b')
    const viewEndMs = xToTime(width, view)
    const activeBar = drag?.bar ?? selectedBar
    const activeBarMs = activeBar !== null ? timeline.timeOfBeat(timeline.barStartBeat(activeBar)) : null
    const stage = cssVar('--sb-stage', '#000000')

    const audio = audioCanvas.current?.getContext('2d')
    if (audio && audioCanvas.current) {
      audioCanvas.current.width = (vertical ? audioH : width) * dpr
      audioCanvas.current.height = (vertical ? width : audioH) * dpr
      // Vertical: swap the axes, so the drawing below stays in along/across coordinates.
      if (vertical) audio.setTransform(0, dpr, dpr, 0, 0, 0)
      else audio.setTransform(dpr, 0, 0, dpr, 0, 0)
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
      // The dragged or selected bar line runs on through the waveform, so it can be laid exactly
      // onto the hit there (Marco, 2026-09-28).
      if (activeBarMs !== null) {
        audio.fillStyle = accent
        audio.fillRect(timeToX(activeBarMs, view) - 1.5, 0, 3, audioH)
      }
    }

    const g = gridCanvas.current?.getContext('2d')
    if (g && gridCanvas.current) {
      const h = SECTION_H + gridH
      gridCanvas.current.width = (vertical ? h : width) * dpr
      gridCanvas.current.height = (vertical ? width : h) * dpr
      if (vertical) g.setTransform(0, dpr, dpr, 0, 0, 0)
      else g.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Text is drawn upright in both layouts: in the swapped (vertical) system it would come out
      // mirrored, so labels switch to the plain transform at the swapped position.
      // Labels sit on a patch of the lane background, so bar lines never run through the digits.
      const label = (text: string, along: number, across: number, verticalAlong: number, verticalAcross: number) => {
        const [tx, ty] = vertical ? [verticalAcross, verticalAlong] : [along, across]
        g.save()
        if (vertical) g.setTransform(dpr, 0, 0, dpr, 0, 0)
        const color = g.fillStyle
        const w = g.measureText(text).width
        g.fillStyle = stage
        g.fillRect(tx - 2, ty - 14, w + 4, 18)
        g.fillStyle = color
        g.fillText(text, tx, ty)
        g.restore()
      }
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
      // Zoomed far out, every bar line merged into a white block (portrait, 2026-09-28): below
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
          label(String(beat.bar), x + 4, SECTION_H + 16, x + 16, SECTION_H + 4)
        }
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
      const labelRoom = vertical ? 30 : 100
      let lastLabelX = -Infinity
      for (const stretch of tempoLabels) {
        const x = Math.max(4, timeToX(stretch.fromMs, view) + 6)
        if (x > width || x - lastLabelX < labelRoom) continue
        lastLabelX = x
        const text = vertical ? stretch.bpm.toFixed(1) : `${stretch.bpm.toFixed(1)} BPM`
        label(text, x, 18, x + 12, 2)
      }
    }
  }, [width, vertical, audioH, gridH, view, analysis, quality, timeline, stretches, shownGrid, bpm, countInStartMs, drag, selectedBar])

  // --- pointer handling ---
  /** Pointer position: `x` along the time axis, `y` across the lanes (swapped when vertical). */
  function logical(e: { clientX: number; clientY: number; currentTarget: Element }): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    return vertical ? { x: py, y: px } : { x: px, y: py }
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
    const bar = y >= audioH ? barAt(x) : null
    if (bar !== null) {
      setDrag({ pointerId: e.pointerId, bar, startX: x, x, moved: false })
      return
    }
    pan.current = { pointerId: e.pointerId, startX: x, startView: view, moved: false }
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
      setSelectedBar(drag.bar)
      if (drag.moved && dragMs !== null) alignBar(drag.bar, dragMs)
      setDrag(null)
      return
    }
    const p = pan.current
    if (p && p.pointerId === e.pointerId && !p.moved) {
      setSelectedBar(null)
      seek(xToTime(p.startX, view))
    }
    pan.current = null
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    const { x } = logical(e)
    if (e.ctrlKey || e.metaKey) {
      setView(clampView(zoomAround(view, Math.exp(e.deltaY * 0.002), x), width, minMs, durationMs))
    } else {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      setView(clampView({ ...view, startMs: view.startMs + delta * view.msPerPx }, width, minMs, durationMs))
    }
  }

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
    setSelectedBar(1)
  }

  /** "Tempo tippen" ends: the tempo is the slope through the taps, for the whole song - a grid
   * aligned at several bars gives them up (after asking), bar 1 stays. */
  async function finishTapping() {
    setTapping(false)
    const tapped = tempoFromTaps(taps.current)
    taps.current = []
    setTapCount(0)
    if (tapped === null) {
      setNotice('Mindestens 4 Schläge im Takt tippen.')
      return
    }
    let grid = beatGrid
    if (grid && grid.points.length > 1) {
      if (!(await confirm(`${tapped.toFixed(1)} BPM für den ganzen Song übernehmen? Die Ausrichtungspunkte nach Takt 1 werden entfernt. (Rückgängig möglich)`, { confirmLabel: 'Übernehmen' }))) return
      const first = [...grid.points].sort((a, b) => a.bar - b.bar)[0]!
      grid = { ...grid, points: [first] }
    }
    setNotice(`Tempo: ${tapped.toFixed(1)} BPM`)
    commitGrid(grid, tapped)
  }
  function tap() {
    taps.current.push(useClockStore.getState().getElapsedMs())
    setTapCount(taps.current.length)
  }

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
      commit(result)
    } catch {
      setNotice('Analyse fehlgeschlagen.')
    } finally {
      setDetecting(false)
    }
  }

  async function clearGrid() {
    if (!(await confirm('Klick-Raster löschen? Der Klick läuft danach ab 0:00 im eingetragenen Tempo. (Rückgängig möglich)', { confirmLabel: 'Löschen', danger: true }))) return
    setSelectedBar(null)
    commit({ beatGrid: undefined, bpm })
  }

  async function editMeter(bar: number) {
    const current = shownGrid?.meters.find((m) => m.bar === bar)?.timeSignature ?? ''
    const result = await promptFields(`Taktart ab Takt ${bar}`, [{ key: 'ts', label: 'Taktart (leer = wie davor)', defaultValue: current }], 'Übernehmen')
    if (!result) return
    const ts = (result.ts ?? '').trim()
    if (ts && !/^\d+\/\d+$/.test(ts)) {
      setNotice('Taktart wie 4/4, 3/4 oder 6/8 eingeben.')
      return
    }
    commitGrid(setMeter(editableGrid, bar, ts || null))
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
    setSelectedBar(timeline.barOf(timeline.beatAtOrBefore(bar.startMs + 1)))
    seek(bar.startMs)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (e.key === ' ' && e.target === e.currentTarget) {
      e.preventDefault()
      clock.togglePlay()
    } else if (selectedBar !== null && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      alignBar(selectedBar, selectedBarMs! + (e.key === 'ArrowLeft' ? -10 : 10))
    }
  }

  // The selected bar line: where it is, whether it is a point, the tempo on either side.
  const selectedBarMs = selectedBar !== null ? timeline.timeOfBeat(timeline.barStartBeat(selectedBar)) : null
  const selectedPoint = selectedBar !== null ? shownGrid?.points.find((p) => p.bar === selectedBar) : undefined
  const selectedTempo = selectedBar !== null ? 60000 / timeline.periodAfter(timeline.barStartBeat(selectedBar)) : null

  const playheadX = timeToX(playheadMs, view)
  const button = 'min-h-12 rounded-sb-sm bg-control-strong px-3 text-sm font-semibold text-ink hover:bg-control-strong-hover disabled:opacity-40'
  const toggle = (on: boolean) => `${button} ${on ? '!bg-accent !text-accent-ink' : ''}`
  const iconButton = 'flex min-h-12 min-w-12 items-center justify-center rounded-sb-sm bg-control-strong px-3 text-ink hover:bg-control-strong-hover disabled:opacity-40'
  const hint = !beatGrid
    ? 'Auf den ersten Schlag in der Wellenform tippen, dann „Takt 1 hier“ – danach „Tempo tippen“.'
    : 'Wo das Raster danebenliegt: hineinzoomen und den Taktstrich auf den Schlag in der Wellenform ziehen.'

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
        <button type="button" className={button} onClick={setBar1Here}>
          Takt 1 hier
        </button>
        <button type="button" className={toggle(tapping)} aria-pressed={tapping} disabled={!trackSrc} onClick={() => (tapping ? void finishTapping() : setTapping(true))}>
          {tapping ? `Tippen beenden (${tapCount})` : 'Tempo tippen'}
        </button>
        {onDetectGrid && (
          <button type="button" className={button} disabled={!trackSrc || detecting || tapping} onClick={() => void detectGrid()}>
            {detecting ? 'Analysiere…' : 'Track analysieren'}
          </button>
        )}
        <button type="button" className={button} disabled={quality.length === 0} onClick={jumpToNextProblem}>
          Nächste Problemstelle
        </button>
        <button type="button" className={button} disabled={!beatGrid || tapping} onClick={() => void clearGrid()}>
          Raster löschen
        </button>
      </div>
      <p className="text-sm text-ink-soft" role="status">
        {notice ?? hint}
      </p>

      {!trackId && <p className="text-sm text-ink-faint">Kein Track angehängt - die Timeline zeigt nur das Raster.</p>}
      {analysisState === 'loading' && <p className="text-sm text-ink-faint">Wellenform wird berechnet…</p>}
      {analysisState === 'error' && <p className="text-sm text-amber-500">Track auf diesem Gerät nicht verfügbar - keine Wellenform.</p>}

      <div
        ref={boxRef}
        className={`relative w-full select-none overflow-hidden rounded-sb border border-line bg-stage ${fill ? 'min-h-48 flex-1' : ''}`}
        style={{ height: fill ? undefined : audioH + SECTION_H + gridH, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        data-testid="timeline-lanes"
      >
        <canvas
          ref={audioCanvas}
          className="absolute left-0 top-0"
          style={vertical ? { width: audioH, height: width } : { width, height: audioH }}
        />
        <canvas
          ref={gridCanvas}
          className="absolute"
          style={vertical ? { left: audioH, top: 0, width: SECTION_H + gridH, height: width } : { left: 0, top: audioH, width, height: SECTION_H + gridH }}
        />
        {playheadX >= 0 && playheadX <= width && (
          <div
            className={`pointer-events-none absolute bg-red-500 ${vertical ? 'left-0 h-0.5 w-full' : 'top-0 h-full w-0.5'}`}
            style={vertical ? { top: playheadX } : { left: playheadX }}
            data-testid="timeline-playhead"
          />
        )}
      </div>

      {tapping && (
        <button type="button" className="h-touch-primary rounded-sb bg-accent text-xl font-black text-accent-ink" onPointerDown={() => clock.isPlaying && tap()}>
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

      <audio {...clock.audioProps} className="hidden" />
    </div>
  )
}
