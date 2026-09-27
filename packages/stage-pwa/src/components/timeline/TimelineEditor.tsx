import { useEffect, useMemo, useRef, useState } from 'react'
import type { BeatGrid } from 'shared-types'
import { beatsBetween, clickTimeline, gridStretches } from '../../lib/beatGrid'
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
const MOVE_THRESHOLD_PX = 6

const QUALITY_COLOR = { good: '#16a34a', ok: '#d97706', poor: '#dc2626', quiet: '#52525b' } as const

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return tokenColor(getComputedStyle(document.documentElement).getPropertyValue(name), fallback)
}

type Pan = { pointerId: number; startX: number; startView: TimelineView; moved: boolean }

/**
 * The timeline editor (docs/14): the track's waveform and the click grid (docs/14 §5a) on one
 * time axis - bar lines, the alignment points as diamonds, the tempo of every stretch, and a
 * colour per bar for how well it sits on the track's drum hits. Works on the song editor's draft;
 * nothing is written until the song editor saves. Touch and mouse alike: swipe = scroll, tap =
 * move the playhead, pinch / Ctrl+wheel = zoom.
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

  const [analysis, setAnalysis] = useState<TrackAnalysis | null>(null)
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [view, setView] = useState<TimelineView>({ startMs: 0, msPerPx: 20 })
  const [clickOn, setClickOn] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const lastProblemMs = useRef<number | null>(null)
  const pan = useRef<Pan | null>(null)
  const pinch = useRef<{ startDistance: number; startView: TimelineView; centerX: number } | null>(null)
  const pointers = useRef(new Map<number, number>())
  const [undoStack, setUndoStack] = useState<TimelineGridState[]>([])
  const [redoStack, setRedoStack] = useState<TimelineGridState[]>([])

  const timeline = useMemo(
    () => clickTimeline({ beatGrid, bpm, timeSignature, countInBars: countInEnabled ? countInBars : 0 }),
    [beatGrid, bpm, timeSignature, countInEnabled, countInBars],
  )
  const stretches = useMemo(() => (beatGrid ? gridStretches(beatGrid, bpm, timeSignature) : []), [beatGrid, bpm, timeSignature])
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

  // Fit the whole song into view once its length is known.
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || box.width <= 0 || durationMs <= 0) return
    fitted.current = true
    setView({ startMs: minMs, msPerPx: Math.max(1, (durationMs - minMs) / width) })
  }, [box.width, width, durationMs, minMs])

  function commit(next: TimelineGridState) {
    setUndoStack((stack) => [...stack.slice(-49), { beatGrid, bpm }])
    setRedoStack([])
    onChange(next)
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

  // --- drawing ---
  useEffect(() => {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    const ink = cssVar('--sb-ink', '#e5e5e5')
    const faint = cssVar('--sb-ink-faint', '#a3a3a3')
    const accent = cssVar('--sb-accent', '#f59e0b')
    const viewEndMs = xToTime(width, view)

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
      const label = (text: string, along: number, across: number, verticalAlong: number, verticalAcross: number) => {
        if (!vertical) {
          g.fillText(text, along, across)
          return
        }
        g.save()
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        g.fillText(text, verticalAcross, verticalAlong)
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
      // Beats and bars.
      const firstVisible = Math.max(timeline.firstBeat, timeline.beatAtOrBefore(view.startMs))
      const period = timeline.periodAfter(firstVisible)
      const barMs = timeline.timeOfBeat(timeline.barStartBeat(timeline.barOf(firstVisible) + 1)) - timeline.timeOfBeat(timeline.barStartBeat(timeline.barOf(firstVisible)))
      const showBeats = period / view.msPerPx >= 12
      const labelEvery = barLabelEvery(barMs / view.msPerPx)
      for (const beat of beatsBetween(timeline, view.startMs, viewEndMs)) {
        const isBar = beat.beatInBar === 0
        if (!isBar && !showBeats) continue
        const x = timeToX(beat.timeMs, view)
        g.strokeStyle = isBar ? ink : faint
        g.lineWidth = isBar ? 2 : 1
        g.beginPath()
        g.moveTo(x + 0.5, SECTION_H + (isBar ? 0 : gridH * 0.45))
        g.lineTo(x + 0.5, h - 12)
        g.stroke()
        if (isBar && beat.bar >= 1 && (beat.bar - 1) % labelEvery === 0) {
          g.fillStyle = ink
          g.font = '14px system-ui, sans-serif'
          label(String(beat.bar), x + 4, SECTION_H + 16, x + 16, SECTION_H + 4)
        }
      }
      // Alignment points as diamonds on their bar lines.
      g.fillStyle = accent
      for (const point of beatGrid?.points ?? []) {
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
      const tempoLabels = stretches.length ? stretches : [{ fromMs: timeline.bar1Ms, bpm }]
      for (const stretch of tempoLabels) {
        const x = Math.max(4, timeToX(stretch.fromMs, view) + 6)
        if (x > width) continue
        const text = vertical ? stretch.bpm.toFixed(1) : `${stretch.bpm.toFixed(1)} BPM`
        label(text, x, 18, x + 12, 2)
      }
    }
  }, [width, vertical, audioH, gridH, view, analysis, quality, timeline, stretches, beatGrid, bpm, countInStartMs])

  // --- pointer handling: swipe scrolls, tap moves the playhead, two fingers zoom ---
  /** Position along the time axis (swapped when vertical). */
  function along(e: { clientX: number; clientY: number; currentTarget: Element }): number {
    const rect = e.currentTarget.getBoundingClientRect()
    return vertical ? e.clientY - rect.top : e.clientX - rect.left
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const x = along(e)
    pointers.current.set(e.pointerId, x)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { startDistance: Math.abs(a! - b!) || 1, startView: view, centerX: (a! + b!) / 2 }
      pan.current = null
      return
    }
    pan.current = { pointerId: e.pointerId, startX: x, startView: view, moved: false }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const x = along(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, x)
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.abs(a! - b!) || 1
      setView(clampView(zoomAround(pinch.current.startView, pinch.current.startDistance / distance, pinch.current.centerX), width, minMs, durationMs))
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
    const p = pan.current
    if (p && p.pointerId === e.pointerId && !p.moved) seek(xToTime(p.startX, view))
    pan.current = null
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    const x = along(e)
    if (e.ctrlKey || e.metaKey) {
      setView(clampView(zoomAround(view, Math.exp(e.deltaY * 0.002), x), width, minMs, durationMs))
    } else {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      setView(clampView({ ...view, startMs: view.startMs + delta * view.msPerPx }, width, minMs, durationMs))
    }
  }

  // --- grid-wide actions ---
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
    commit({ beatGrid: undefined, bpm })
  }

  /** "Nächste Problemstelle": the next red (else orange) bar after the playhead, zoomed so a few
   * bars fill the view and the playhead on it - ready to listen. */
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
    }
  }

  const playheadX = timeToX(playheadMs, view)
  const button = 'min-h-12 rounded-sb-sm bg-control-strong px-3 text-sm font-semibold text-ink hover:bg-control-strong-hover disabled:opacity-40'
  const toggle = (on: boolean) => `${button} ${on ? '!bg-accent !text-accent-ink' : ''}`
  // `!` - the size must beat `button`'s text-sm; the Fire drew the arrows tiny without it.
  const iconButton = 'min-h-12 min-w-12 rounded-sb-sm bg-control-strong px-3 !text-2xl font-semibold text-ink hover:bg-control-strong-hover disabled:opacity-40'

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
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onDetectGrid && (
          <button type="button" className={button} disabled={!trackSrc || detecting} onClick={() => void detectGrid()}>
            {detecting ? 'Analysiere…' : 'Track analysieren'}
          </button>
        )}
        <button type="button" className={button} disabled={quality.length === 0} onClick={jumpToNextProblem}>
          Nächste Problemstelle
        </button>
        <button type="button" className={button} disabled={!beatGrid} onClick={() => void clearGrid()}>
          Raster löschen
        </button>
        <button type="button" className={iconButton} onClick={undo} disabled={undoStack.length === 0} aria-label="Rückgängig">
          ↶
        </button>
        <button type="button" className={iconButton} onClick={redo} disabled={redoStack.length === 0} aria-label="Wiederholen">
          ↷
        </button>
      </div>
      {notice && <p className="text-sm text-ink-soft" role="status">{notice}</p>}

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

      <audio {...clock.audioProps} className="hidden" />
    </div>
  )
}
