import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BeatAnchor, TempoMarker } from 'shared-types'
import { startClick, stopClick } from '../../lib/clickEngine'
import { beatsPerBar } from '../../lib/metronome'
import { randomId } from '../../lib/id'
import { mergeTappedAnchors, tempoMapFor } from '../../lib/tempoMap'
import {
  barQuality,
  beatsAreGrabbable,
  clampView,
  formatTimelineTime,
  hitBeat,
  barLabelEvery,
  periodAt,
  tokenColor,
  pinBeat,
  removeAnchor,
  setDownbeat,
  timeToX,
  xToTime,
  zoomAround,
  type SnapMode,
  type TimelineView,
} from '../../lib/timeline'
import { loadTrackAnalysis, type TrackAnalysis } from '../../lib/trackAnalysis'
import { useElementSize } from '../../lib/useElementSize'
import { useTrackClock } from '../../lib/useTrackClock'
import { useClockStore } from '../../store/useClockStore'
import { useDialogStore } from '../../store/useDialogStore'
import { TempoMapQualityNote } from '../TempoMapQualityNote'

export interface TimelineEditorProps {
  variantId: string
  /** The track to show and play (band mix, else reference) - null: grid only. */
  trackId: string | null
  trackSrc: string | null
  anchors: BeatAnchor[]
  tempoMarkers: TempoMarker[]
  bpm: number
  timeSignature: string
  countInEnabled: boolean
  countInBars: number
  onChange: (patch: { beatAnchors: BeatAnchor[]; tempoMarkers: TempoMarker[] }) => void
  /** The quality note's "adopt the measured tempo" - the variant's bpm lives outside the grid. */
  onAdoptBpm: (bpm: number) => void
  /** Full screen (docs/14): the lanes take all the height the parent gives the component. */
  fill?: boolean
}

type Selection = { kind: 'beat'; index: number } | { kind: 'marker'; id: string } | null
type Drag =
  | { kind: 'beat'; index: number; pointerId: number; startX: number; moved: boolean; x: number }
  | { kind: 'marker'; id: string; pointerId: number; startX: number; moved: boolean; x: number }
  | { kind: 'pan'; pointerId: number; startX: number; startView: TimelineView; moved: boolean; lane: 'audio' | 'grid' }
  | null

/** Lane heights in the compact layout; full screen (`fill`) splits the available height. */
const DEFAULT_AUDIO_H = 96
const SECTION_H = 26
const DEFAULT_GRID_H = 84
const TOLERANCE_PX = 24
const MOVE_THRESHOLD_PX = 6
/** A dragged bar line within this distance of a detected onset lands on it (with snapping on). */
const ONSET_MAGNET_MS = 40

const QUALITY_COLOR = { good: '#16a34a', ok: '#d97706', poor: '#dc2626', quiet: '#52525b' } as const

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return tokenColor(getComputedStyle(document.documentElement).getPropertyValue(name), fallback)
}

/**
 * The timeline editor (docs/14), phase 1: the track's waveform and the fitted beat grid on one
 * time axis, with the grid editable - drag a bar line (stored as a fixed anchor), set beat 1,
 * set tempo sections, re-tap a stretch. Works on the song editor's draft; nothing is written
 * until the song editor saves. Touch and mouse alike: tap = select, drag = move, swipe = scroll,
 * pinch / Ctrl+wheel = zoom; the selection bar gives finger-sized fine steps.
 */
export function TimelineEditor(props: TimelineEditorProps) {
  const { variantId, trackId, trackSrc, anchors, tempoMarkers, bpm, timeSignature, countInEnabled, countInBars, onChange, onAdoptBpm, fill = false } = props
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
  const promptFields = useDialogStore((state) => state.promptFields)

  const [analysis, setAnalysis] = useState<TrackAnalysis | null>(null)
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [view, setView] = useState<TimelineView>({ startMs: 0, msPerPx: 20 })
  const [selection, setSelection] = useState<Selection>(null)
  const [snap, setSnap] = useState<SnapMode>('bar')
  const [clickOn, setClickOn] = useState(true)
  const [showRaw, setShowRaw] = useState(false)
  const [tapping, setTapping] = useState(false)
  const [tapCount, setTapCount] = useState(0)
  const taps = useRef<BeatAnchor[]>([])
  const [drag, setDrag] = useState<Drag>(null)
  const pinch = useRef<{ ids: number[]; startDistance: number; startView: TimelineView; centerX: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const [undoStack, setUndoStack] = useState<{ anchors: BeatAnchor[]; tempoMarkers: TempoMarker[] }[]>([])
  const [redoStack, setRedoStack] = useState<{ anchors: BeatAnchor[]; tempoMarkers: TempoMarker[] }[]>([])

  const map = tempoMapFor({ beatAnchors: anchors, bpm, timeSignature, tempoMarkers })
  const grid = map.beats
  const perBar = beatsPerBar(timeSignature)
  const quality = useMemo(() => (analysis ? barQuality(grid, analysis.onsetsMs) : []), [grid, analysis])
  const firstBeatMs = grid[0]?.timeMs ?? 0
  const countInMs = countInEnabled ? countInBars * perBar * periodAt(firstBeatMs, grid) : 0
  const durationMs = analysis?.durationMs ?? (clock.duration > 0 ? clock.duration * 1000 : (grid[grid.length - 1]?.timeMs ?? 0) + 4000)
  const minMs = Math.min(0, firstBeatMs - countInMs)

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

  const commit = useCallback(
    (next: { beatAnchors?: BeatAnchor[]; tempoMarkers?: TempoMarker[] }) => {
      setUndoStack((stack) => [...stack.slice(-49), { anchors, tempoMarkers }])
      setRedoStack([])
      onChange({ beatAnchors: next.beatAnchors ?? anchors, tempoMarkers: next.tempoMarkers ?? tempoMarkers })
    },
    [anchors, tempoMarkers, onChange],
  )

  function undo() {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    setUndoStack(undoStack.slice(0, -1))
    setRedoStack([...redoStack, { anchors, tempoMarkers }])
    onChange({ beatAnchors: previous.anchors, tempoMarkers: previous.tempoMarkers })
  }

  function redo() {
    const next = redoStack[redoStack.length - 1]
    if (!next) return
    setRedoStack(redoStack.slice(0, -1))
    setUndoStack([...undoStack, { anchors, tempoMarkers }])
    onChange({ beatAnchors: next.anchors, tempoMarkers: next.tempoMarkers })
  }

  // Click preview while the editor plays (clickEngine, the same one the show uses).
  const clickState = useRef({ anchors: grid, playing: false })
  clickState.current = { anchors: grid, playing: clock.isPlaying }
  useEffect(() => {
    if (!clickOn || !clock.isPlaying) return
    startClick(() => ({
      elapsedMs: clickState.current.playing ? useClockStore.getState().getElapsedMs() : null,
      bpm,
      timeSignature,
      beatAnchors: clickState.current.anchors,
      countInBars: 0,
      tempoMarkers,
    }))
    return () => stopClick()
  }, [clickOn, clock.isPlaying, bpm, timeSignature, tempoMarkers])

  // Taps become observations when tapping ends (or playback stops).
  function finishTapping() {
    setTapping(false)
    if (taps.current.length >= 2) commit({ beatAnchors: mergeTappedAnchors(anchors, taps.current, bpm) })
    taps.current = []
    setTapCount(0)
  }
  function tap() {
    taps.current.push({ id: randomId(), timeMs: Math.max(0, Math.round(useClockStore.getState().getElapsedMs())) })
    setTapCount(taps.current.length)
  }
  useEffect(() => {
    if (tapping && !clock.isPlaying && taps.current.length > 0) finishTapping()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.isPlaying])

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

  const dragTimeMs = (d: Drag): number | null => {
    if (!d || d.kind === 'pan' || !d.moved) return null
    let ms = xToTime(d.x, view)
    if (d.kind === 'beat' && snap !== 'off' && analysis) {
      const near = analysis.onsetsMs.reduce((best, o) => (Math.abs(o - ms) < Math.abs(best - ms) ? o : best), Infinity)
      if (Math.abs(near - ms) <= ONSET_MAGNET_MS) ms = near
    }
    if (d.kind === 'marker' && snap !== 'off') {
      const bars = grid.filter((b) => (b.beatInBar ?? 0) === 0 || snap === 'beat')
      const near = bars.reduce((best, b) => (Math.abs(b.timeMs - ms) < Math.abs(best - ms) ? b.timeMs : best), Infinity)
      if (Number.isFinite(near)) ms = near
    }
    return ms
  }

  // --- drawing ---
  useEffect(() => {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    const ink = cssVar('--sb-ink', '#e5e5e5')
    const faint = cssVar('--sb-ink-faint', '#a3a3a3')
    const accent = cssVar('--sb-accent', '#f59e0b')

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
      if (countInMs > 0) {
        audio.fillStyle = 'rgba(59,130,246,0.15)'
        const x0 = timeToX(firstBeatMs - countInMs, view)
        audio.fillRect(x0, 0, timeToX(firstBeatMs, view) - x0, audioH)
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
      const showBeats = beatsAreGrabbable(periodAt(firstBeatMs, grid), view) || view.msPerPx < 12
      let barNumber = 0
      const labelEvery = barLabelEvery((periodAt(firstBeatMs, grid) * perBar) / view.msPerPx)
      const draggedMs = dragTimeMs(drag)
      grid.forEach((beat, i) => {
        const isBar = (beat.beatInBar ?? 0) === 0
        if (isBar) barNumber++
        const ms = drag?.kind === 'beat' && drag.index === i && draggedMs !== null ? draggedMs : beat.timeMs
        const x = timeToX(ms, view)
        if (x < -2 || x > width + 2 || (!isBar && !showBeats)) return
        const selected = selection?.kind === 'beat' && selection.index === i
        g.strokeStyle = selected ? accent : isBar ? ink : faint
        g.lineWidth = selected ? 3 : isBar ? 2 : 1
        g.beginPath()
        g.moveTo(x + 0.5, SECTION_H + (isBar ? 0 : gridH * 0.45))
        g.lineTo(x + 0.5, h - 12)
        g.stroke()
        if (isBar && (barNumber - 1) % labelEvery === 0) {
          g.fillStyle = ink
          g.font = '14px system-ui, sans-serif'
          label(String(barNumber), x + 4, SECTION_H + 16, x + 16, SECTION_H + 4)
        }
      })
      // Raw anchors (observations) as small dots; fixed ones as accent diamonds.
      for (const a of anchors) {
        const x = timeToX(a.timeMs, view)
        if (x < 0 || x > width) continue
        if (a.pinned) {
          g.fillStyle = accent
          g.beginPath()
          g.moveTo(x, SECTION_H + gridH - 30)
          g.lineTo(x + 6, SECTION_H + gridH - 24)
          g.lineTo(x, SECTION_H + gridH - 18)
          g.lineTo(x - 6, SECTION_H + gridH - 24)
          g.fill()
        } else if (showRaw) {
          g.fillStyle = faint
          g.fillRect(x - 1.5, SECTION_H + gridH - 26, 3, 3)
        }
      }
      // Tempo sections along the top strip.
      g.fillStyle = 'rgba(255,255,255,0.06)'
      g.fillRect(0, 0, width, SECTION_H)
      for (const marker of tempoMarkers) {
        const ms = drag?.kind === 'marker' && drag.id === marker.id && draggedMs !== null ? draggedMs : marker.timeMs
        const x = timeToX(ms, view)
        if (x < -80 || x > width) continue
        const selected = selection?.kind === 'marker' && selection.id === marker.id
        g.fillStyle = selected ? accent : '#3b82f6'
        g.fillRect(x, 0, 3, SECTION_H + gridH)
        g.fillStyle = ink
        g.font = 'bold 14px system-ui, sans-serif'
        // Portrait: the section strip is a narrow column - just the tempo there.
        const markerText = vertical ? `${marker.bpm}` : `${marker.bpm} BPM${marker.timeSignature ? ` ${marker.timeSignature}` : ''}`
        label(markerText, x + 6, 18, x + 16, 2)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, vertical, audioH, gridH, view, analysis, grid, quality, anchors, tempoMarkers, selection, drag, showRaw, countInMs, firstBeatMs, snap])

  // --- pointer handling ---
  function laneOf(y: number): 'audio' | 'section' | 'grid' {
    if (y < audioH) return 'audio'
    return y < audioH + SECTION_H ? 'section' : 'grid'
  }

  /** Pointer position as x = along the time axis, y = across the lanes (swapped when vertical). */
  function logical(e: { clientX: number; clientY: number; currentTarget: Element }): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    return vertical ? { x: py, y: px } : { x: px, y: py }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const { x, y } = logical(e)
    pointers.current.set(e.pointerId, { x, y })
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { ids: [...pointers.current.keys()], startDistance: Math.abs(a!.x - b!.x) || 1, startView: view, centerX: (a!.x + b!.x) / 2 }
      setDrag(null)
      return
    }
    const lane = laneOf(y)
    if (lane === 'section') {
      const hit = tempoMarkers.find((m) => Math.abs(timeToX(m.timeMs, view) - x) <= TOLERANCE_PX)
      if (hit) {
        setDrag({ kind: 'marker', id: hit.id, pointerId: e.pointerId, startX: x, moved: false, x })
        return
      }
    }
    if (lane === 'grid' || lane === 'section') {
      const index = hitBeat(x, grid, view, TOLERANCE_PX, !beatsAreGrabbable(periodAt(xToTime(x, view), grid), view))
      if (index >= 0) {
        setDrag({ kind: 'beat', index, pointerId: e.pointerId, startX: x, moved: false, x })
        return
      }
    }
    setDrag({ kind: 'pan', pointerId: e.pointerId, startX: x, startView: view, moved: false, lane: lane === 'audio' ? 'audio' : 'grid' })
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const { x, y } = logical(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x, y })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.abs(a!.x - b!.x) || 1
      setView(clampView(zoomAround(pinch.current.startView, pinch.current.startDistance / distance, pinch.current.centerX), width, minMs, durationMs))
      return
    }
    if (!drag || drag.pointerId !== e.pointerId) return
    const moved = drag.moved || Math.abs(x - drag.startX) > MOVE_THRESHOLD_PX
    if (drag.kind === 'pan') {
      if (moved) setView(clampView({ ...drag.startView, startMs: drag.startView.startMs - (x - drag.startX) * drag.startView.msPerPx }, width, minMs, durationMs))
      setDrag({ ...drag, moved })
    } else {
      setDrag({ ...drag, moved, x })
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null
      return
    }
    if (!drag || drag.pointerId !== e.pointerId) return
    const ms = dragTimeMs(drag)
    if (drag.kind === 'pan') {
      if (!drag.moved) {
        setSelection(null)
        seek(xToTime(drag.startX, view))
      }
    } else if (drag.kind === 'beat') {
      setSelection({ kind: 'beat', index: drag.index })
      if (ms !== null) {
        const beat = grid[drag.index]!
        commit({ beatAnchors: pinBeat(anchors, beat.timeMs, ms, beat.beatInBar ?? 0, periodAt(beat.timeMs, grid)) })
      }
    } else if (drag.kind === 'marker') {
      setSelection({ kind: 'marker', id: drag.id })
      if (ms !== null) {
        commit({ tempoMarkers: tempoMarkers.map((m) => (m.id === drag.id ? { ...m, timeMs: Math.max(0, Math.round(ms)) } : m)).sort((a, b) => a.timeMs - b.timeMs) })
      }
    }
    setDrag(null)
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

  // --- selection actions ---
  const selectedBeat = selection?.kind === 'beat' ? grid[selection.index] : undefined
  const selectedMarker = selection?.kind === 'marker' ? tempoMarkers.find((m) => m.id === selection.id) : undefined
  const selectedPeriod = selectedBeat ? periodAt(selectedBeat.timeMs, grid) : 500
  const pinnedAtSelection = selectedBeat ? anchors.find((a) => a.pinned && Math.abs(a.timeMs - selectedBeat.timeMs) < selectedPeriod / 2) : undefined
  const barOf = (index: number) => grid.slice(0, index + 1).filter((b) => (b.beatInBar ?? 0) === 0).length

  function nudgeSelectedBeat(deltaMs: number) {
    if (!selectedBeat || selection?.kind !== 'beat') return
    commit({ beatAnchors: pinBeat(anchors, selectedBeat.timeMs, selectedBeat.timeMs + deltaMs, selectedBeat.beatInBar ?? 0, selectedPeriod) })
  }

  async function editMarker(marker: TempoMarker) {
    const result = await promptFields(
      'Tempo-Abschnitt',
      [
        { key: 'bpm', label: 'Tempo (BPM)', defaultValue: String(marker.bpm) },
        { key: 'timeSignature', label: 'Taktart', defaultValue: marker.timeSignature ?? timeSignature },
      ],
      'Übernehmen',
    )
    if (!result) return
    const nextBpm = Number(result.bpm?.replace(',', '.'))
    if (!(nextBpm > 0)) return
    const ts = /^\d+\/\d+$/.test(result.timeSignature ?? '') ? result.timeSignature : undefined
    commit({ tempoMarkers: tempoMarkers.map((m) => (m.id === marker.id ? { ...m, bpm: Math.round(nextBpm * 10) / 10, timeSignature: ts } : m)) })
  }

  function addSectionAtSelection() {
    if (!selectedBeat) return
    const marker: TempoMarker = { id: randomId(), timeMs: selectedBeat.timeMs, bpm: Math.round((60000 / selectedPeriod) * 10) / 10 }
    commit({ tempoMarkers: [...tempoMarkers, marker].sort((a, b) => a.timeMs - b.timeMs) })
    setSelection({ kind: 'marker', id: marker.id })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if (e.code === 'Space') {
      e.preventDefault()
      if (tapping && clock.isPlaying) tap()
      else clock.togglePlay()
      return
    }
    if (selection?.kind === 'beat' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      const sign = e.key === 'ArrowLeft' ? -1 : 1
      nudgeSelectedBeat(sign * (e.shiftKey ? 10 : selectedPeriod))
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && pinnedAtSelection) {
      e.preventDefault()
      commit({ beatAnchors: removeAnchor(anchors, pinnedAtSelection.id) })
    }
  }

  const button = 'min-h-12 rounded-sb-sm bg-control-strong px-3 text-sm font-semibold text-ink hover:bg-control-strong-hover disabled:opacity-40'
  const toggle = (on: boolean) => `${button} ${on ? '!bg-accent !text-accent-ink' : ''}`
  const playheadX = timeToX(playheadMs, view)

  return (
    <div className={`flex flex-col gap-3 ${fill ? 'h-full min-h-0' : ''}`} onKeyDown={onKeyDown} tabIndex={0} aria-label="Timeline">
      <TempoMapQualityNote
        anchors={anchors}
        bpm={bpm}
        timeSignature={timeSignature}
        tempoMarkers={tempoMarkers}
        onAdoptBpm={onAdoptBpm}
        compact={fill}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={clock.togglePlay} disabled={!trackSrc} aria-label={clock.isPlaying ? 'Pause' : 'Abspielen'}>
          {clock.isPlaying ? '❚❚' : '▶'}
        </button>
        <span className="min-w-20 font-bold tabular-nums">{formatTimelineTime(playheadMs)}</span>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Einrasten
          <select className="min-h-12 rounded-sb-sm bg-control px-2 text-ink" value={snap} onChange={(e) => setSnap(e.target.value as SnapMode)}>
            <option value="bar">Takt / Drum-Hit</option>
            <option value="beat">Schlag / Drum-Hit</option>
            <option value="off">aus</option>
          </select>
        </label>
        <button type="button" className={button} aria-label="Herauszoomen" onClick={() => setView(clampView(zoomAround(view, 1.6, width / 2), width, minMs, durationMs))}>
          −
        </button>
        <button type="button" className={button} aria-label="Hineinzoomen" onClick={() => setView(clampView(zoomAround(view, 1 / 1.6, width / 2), width, minMs, durationMs))}>
          +
        </button>
        <button type="button" className={toggle(clickOn)} aria-pressed={clickOn} onClick={() => setClickOn(!clickOn)}>
          Klick
        </button>
        <button type="button" className={toggle(showRaw)} aria-pressed={showRaw} onClick={() => setShowRaw(!showRaw)}>
          Rohe Anker
        </button>
        <button
          type="button"
          className={toggle(tapping)}
          aria-pressed={tapping}
          disabled={!trackSrc}
          onClick={() => (tapping ? finishTapping() : setTapping(true))}
        >
          {tapping ? `Tippen beenden (${tapCount})` : 'Schläge tippen'}
        </button>
        <button type="button" className={button} onClick={undo} disabled={undoStack.length === 0} aria-label="Rückgängig">
          ↶
        </button>
        <button type="button" className={button} onClick={redo} disabled={redoStack.length === 0} aria-label="Wiederholen">
          ↷
        </button>
      </div>

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

      {selectedBeat && selection?.kind === 'beat' && (
        <div className="flex flex-wrap items-center gap-2 rounded-sb bg-control p-2">
          <span className="font-semibold">
            Takt {barOf(selection.index)}, Schlag {(selectedBeat.beatInBar ?? 0) + 1} · {formatTimelineTime(selectedBeat.timeMs)}
            {pinnedAtSelection ? ' · fixiert' : ''}
          </span>
          <button type="button" className={button} onClick={() => commit({ beatAnchors: setDownbeat(anchors, grid, selection.index, timeSignature) })}>
            Hier ist die Eins
          </button>
          <button type="button" className={button} onClick={() => nudgeSelectedBeat(-selectedPeriod)} aria-label="Einen Schlag früher">
            −1 Schlag
          </button>
          <button type="button" className={button} onClick={() => nudgeSelectedBeat(-10)}>
            −10 ms
          </button>
          <button type="button" className={button} onClick={() => nudgeSelectedBeat(10)}>
            +10 ms
          </button>
          <button type="button" className={button} onClick={() => nudgeSelectedBeat(selectedPeriod)} aria-label="Einen Schlag später">
            +1 Schlag
          </button>
          <button type="button" className={button} onClick={addSectionAtSelection}>
            Abschnitt ab hier
          </button>
          {pinnedAtSelection && (
            <button type="button" className={button} onClick={() => commit({ beatAnchors: removeAnchor(anchors, pinnedAtSelection.id) })}>
              Fixierung lösen
            </button>
          )}
        </div>
      )}

      {selectedMarker && (
        <div className="flex flex-wrap items-center gap-2 rounded-sb bg-control p-2">
          <span className="font-semibold">
            Abschnitt ab {formatTimelineTime(selectedMarker.timeMs)} · {selectedMarker.bpm} BPM {selectedMarker.timeSignature ?? timeSignature}
          </span>
          <button type="button" className={button} onClick={() => void editMarker(selectedMarker)}>
            Tempo / Taktart
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              commit({ tempoMarkers: tempoMarkers.filter((m) => m.id !== selectedMarker.id) })
              setSelection(null)
            }}
          >
            Abschnitt löschen
          </button>
        </div>
      )}

      <audio {...clock.audioProps} className="hidden" />
    </div>
  )
}
