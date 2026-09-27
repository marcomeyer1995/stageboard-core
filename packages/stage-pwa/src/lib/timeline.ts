import type { BeatAnchor } from 'shared-types'
import { beatsPerBar, type BeatAnchorLike } from './metronome'
import { randomId } from './id'

/**
 * Pure logic behind the timeline editor (docs/14): the view (which stretch of the song is on
 * screen, how zoomed), snapping, hit-testing and the grid edits that turn "drag this bar line" or
 * "this is beat 1" into fixed (pinned) anchors for lib/tempoMap.ts. No DOM here, so it is testable.
 */

export interface TimelineView {
  /** Song time at the left edge, ms (may be negative: the count-in). */
  startMs: number
  /** Zoom: song ms per screen pixel. */
  msPerPx: number
}

export const MIN_MS_PER_PX = 1 // ~1 s across 1000 px - individual beats far apart
export const MAX_MS_PER_PX = 400 // a whole song on a phone screen

export const timeToX = (ms: number, view: TimelineView) => (ms - view.startMs) / view.msPerPx
export const xToTime = (x: number, view: TimelineView) => view.startMs + x * view.msPerPx

/** Zooms by `factor` (> 1 = further out) keeping the song time under `anchorX` in place. */
export function zoomAround(view: TimelineView, factor: number, anchorX: number): TimelineView {
  const msPerPx = Math.min(MAX_MS_PER_PX, Math.max(MIN_MS_PER_PX, view.msPerPx * factor))
  const anchorMs = xToTime(anchorX, view)
  return { msPerPx, startMs: anchorMs - anchorX * msPerPx }
}

/** Keeps the view within [minMs, maxMs] (the song plus its count-in), with a little margin. */
export function clampView(view: TimelineView, widthPx: number, minMs: number, maxMs: number): TimelineView {
  const span = widthPx * view.msPerPx
  const margin = Math.min(2000, span * 0.1)
  const lo = minMs - margin
  const hi = Math.max(lo, maxMs + margin - span)
  return { ...view, startMs: Math.min(hi, Math.max(lo, view.startMs)) }
}

export type SnapMode = 'bar' | 'beat' | 'off'

/** The nearest grid line to `ms` - a downbeat in 'bar' mode, any beat in 'beat' mode. */
export function snapTime(ms: number, beats: readonly BeatAnchorLike[], mode: SnapMode): number {
  if (mode === 'off' || beats.length === 0) return ms
  let best = ms
  let bestDistance = Infinity
  for (const beat of beats) {
    if (mode === 'bar' && (beat.beatInBar ?? 0) !== 0) continue
    const distance = Math.abs(beat.timeMs - ms)
    if (distance < bestDistance) {
      best = beat.timeMs
      bestDistance = distance
    }
  }
  return best
}

/** Index of the grid beat nearest to screen position `x` within `tolerancePx`, or -1. With
 * `barsOnly`, only downbeats are candidates (zoomed out, single beats are too close to hit). */
export function hitBeat(x: number, beats: readonly BeatAnchorLike[], view: TimelineView, tolerancePx: number, barsOnly: boolean): number {
  let best = -1
  let bestDistance = tolerancePx
  beats.forEach((beat, i) => {
    if (barsOnly && (beat.beatInBar ?? 0) !== 0) return
    const distance = Math.abs(timeToX(beat.timeMs, view) - x)
    if (distance <= bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  return best
}

/** Whether single beats are far enough apart on screen to be told apart and grabbed. */
export function beatsAreGrabbable(periodMs: number, view: TimelineView): boolean {
  return periodMs / view.msPerPx >= 24
}

export type BarQualityLevel = 'good' | 'ok' | 'poor' | 'quiet'

export interface BarQuality {
  startMs: number
  endMs: number
  /** Share of the bar's beats with an onset within `windowMs`. */
  share: number
  level: BarQualityLevel
}

/** How well each bar's beats sit on the track's onsets - the timeline's quality colour. A bar
 * without any onset near it at all (a quiet passage, a fermata) is 'quiet', not 'poor'. */
export function barQuality(beats: readonly BeatAnchorLike[], onsetsMs: readonly number[], windowMs = 50): BarQuality[] {
  const sorted = [...onsetsMs].sort((a, b) => a - b)
  const nearest = (t: number) => {
    let lo = 0, hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid]! < t) lo = mid + 1
      else hi = mid
    }
    const candidates = [sorted[lo - 1], sorted[lo]].filter((x): x is number => x !== undefined)
    return candidates.length ? Math.min(...candidates.map((c) => Math.abs(c - t))) : Infinity
  }
  const bars: BarQuality[] = []
  let current: number[] = []
  const flush = (endMs: number) => {
    if (current.length === 0) return
    const distances = current.map(nearest)
    const hits = distances.filter((d) => d <= windowMs).length
    const share = hits / current.length
    const quiet = distances.every((d) => d > 3 * windowMs)
    const level: BarQualityLevel = quiet ? 'quiet' : share >= 0.75 ? 'good' : share >= 0.5 ? 'ok' : 'poor'
    bars.push({ startMs: current[0]!, endMs, share, level })
    current = []
  }
  beats.forEach((beat, i) => {
    if ((beat.beatInBar ?? 0) === 0 && current.length) flush(beat.timeMs)
    current.push(beat.timeMs)
    if (i === beats.length - 1) flush(beat.timeMs + (beats.length > 1 ? beat.timeMs - beats[i - 1]!.timeMs : 0))
  })
  return bars
}

/** Local beat length around `ms` from the grid, ms. */
export function periodAt(ms: number, beats: readonly BeatAnchorLike[]): number {
  if (beats.length < 2) return 500
  let i = beats.findIndex((b) => b.timeMs > ms)
  if (i <= 0) i = i === 0 ? 1 : beats.length - 1
  return beats[i]!.timeMs - beats[i - 1]!.timeMs
}

/**
 * Moves the grid beat at `fromMs` to `toMs`: a fixed anchor there, replacing any anchor (fixed or
 * not) within half a beat of either position - they described the same beat. A move before the
 * song start is refused (anchors unchanged): clamped to 0:00 it left a fixed anchor there that
 * no one meant to set, which then pulled the grid's first beat onto 0:00 ("Whats up", 2026-09-27).
 */
export function pinBeat(anchors: readonly BeatAnchor[], fromMs: number, toMs: number, beatInBar: number, periodMs: number): BeatAnchor[] {
  if (toMs < 0) return [...anchors]
  const half = periodMs / 2
  const kept = anchors.filter((a) => Math.abs(a.timeMs - fromMs) >= half && Math.abs(a.timeMs - toMs) >= half)
  const pinned: BeatAnchor = { id: randomId(), timeMs: Math.round(toMs), beatInBar, pinned: true }
  return [...kept, pinned].sort((a, b) => a.timeMs - b.timeMs)
}

/**
 * "This is beat 1": a fixed anchor with beat-in-bar 0 on the chosen grid beat, and every other
 * fixed anchor renumbered to agree (by its position in the current grid) - otherwise an older
 * fixed anchor would keep voting for the old downbeat.
 */
export function setDownbeat(
  anchors: readonly BeatAnchor[],
  grid: readonly BeatAnchorLike[],
  beatIndex: number,
  timeSignature: string,
): BeatAnchor[] {
  const perBar = beatsPerBar(timeSignature)
  const target = grid[beatIndex]
  if (!target) return [...anchors]
  const period = periodAt(target.timeMs, grid)
  const nearestIndex = (ms: number) => {
    let best = 0
    grid.forEach((b, i) => {
      if (Math.abs(b.timeMs - ms) < Math.abs(grid[best]!.timeMs - ms)) best = i
    })
    return best
  }
  const renumbered = anchors.map((a) =>
    a.pinned ? { ...a, beatInBar: (((nearestIndex(a.timeMs) - beatIndex) % perBar) + perBar) % perBar } : a,
  )
  return pinBeat(renumbered, target.timeMs, target.timeMs, 0, period)
}

/** Moves one anchor by `deltaMs` and fixes it - refused before the song start, like `pinBeat`. */
export function nudgeAnchor(anchors: readonly BeatAnchor[], id: string, deltaMs: number): BeatAnchor[] {
  const target = anchors.find((a) => a.id === id)
  if (!target || target.timeMs + deltaMs < 0) return [...anchors]
  return anchors
    .map((a) => (a.id === id ? { ...a, timeMs: Math.round(a.timeMs + deltaMs), pinned: true } : a))
    .sort((a, b) => a.timeMs - b.timeMs)
}

export function removeAnchor(anchors: readonly BeatAnchor[], id: string): BeatAnchor[] {
  return anchors.filter((a) => a.id !== id)
}

/**
 * Tempo for a new section starting at `fromMs`: the median beat spacing of the next `beats` grid
 * beats - not the single gap after it, which at a song start can be the silence before the first
 * hit (that gave a 23.8 BPM section on a 135 BPM song). `fallbackBpm` with too few beats.
 */
export function sectionBpmAt(fromMs: number, grid: readonly BeatAnchorLike[], fallbackBpm: number, beats = 16): number {
  const start = grid.findIndex((b) => b.timeMs >= fromMs - 1)
  if (start < 0) return fallbackBpm
  const times = grid.slice(start, start + beats + 1).map((b) => b.timeMs)
  const gaps = times.slice(1).map((t, i) => t - times[i]!).filter((g) => g > 0).sort((a, b) => a - b)
  if (gaps.length < 2) return fallbackBpm
  const mid = Math.floor(gaps.length / 2)
  const median = gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2
  return Math.round((60000 / median) * 10) / 10
}

/**
 * The next bar after `afterMs` that needs a look: red ('poor') first; when no bar is red, orange
 * ('ok'). Wraps around to the song start, so repeated presses cycle through all of them. Null
 * when every bar is fine or quiet.
 */
export function nextProblemBar(bars: readonly BarQuality[], afterMs: number): BarQuality | null {
  const level: BarQualityLevel | null = bars.some((b) => b.level === 'poor') ? 'poor' : bars.some((b) => b.level === 'ok') ? 'ok' : null
  if (!level) return null
  const candidates = bars.filter((b) => b.level === level)
  return candidates.find((b) => b.startMs > afterMs + 1) ?? candidates[0]!
}

/** "1:23.4", "-0:02.0" (count-in) - timeline readout with tenths. */
export function formatTimelineTime(ms: number): string {
  const negative = ms < 0
  const abs = Math.abs(ms)
  const tenths = Math.round(abs / 100)
  const minutes = Math.floor(tenths / 600)
  const seconds = (tenths % 600) / 10
  return `${negative ? '-' : ''}${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
}

/**
 * A colour token as a canvas colour. The app's tokens hold bare channels ("255 255 255") for
 * Tailwind's `rgb(var(--sb-ink) / <alpha>)` - a canvas ignores such a string without an error
 * and keeps its previous colour (on the tablet the waveform and grid lines simply didn't draw).
 */
export function tokenColor(value: string, fallback: string): string {
  const v = value.trim()
  if (!v) return fallback
  if (/^\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?$/.test(v)) return `rgb(${v})`
  return v
}

/** Label every n-th bar (1, 2, 4, 8 …) so bar numbers never overlap: at least `minPx` apart. */
export function barLabelEvery(barPx: number, minPx = 36): number {
  let every = 1
  while (every * barPx < minPx && every < 1024) every *= 2
  return every
}
