import type { BeatGrid, GridPoint } from 'shared-types'
import { beatsPerBar } from './metronome'
import { randomId } from './id'

/**
 * The rigid click grid (docs/14 §5a): evenly spaced beats aligned to the track at a few bars.
 * Pure arithmetic - no fitting, no smoothing: what the editor shows is exactly what the click
 * plays. A point says "bar n starts at t"; between two points the tempo is constant, before the
 * first and after the last one the neighbouring stretch's tempo carries on, and with a single
 * point the variant's `bpm` sets the spacing (and a live tempo nudge, #140, applies).
 *
 * Beats are numbered from the downbeat of bar 1 (= 0); the count-in before it has negative
 * numbers.
 */

/** Tempo limits for a stretch between two points - a drag that would leave them is refused. */
export const MIN_STRETCH_BPM = 20
export const MAX_STRETCH_BPM = 400

/** A song without a grid of its own: bar 1 at 0:00, at the variant's bpm. */
const DEFAULT_GRID: BeatGrid = { points: [{ id: 'default', bar: 1, timeMs: 0 }], meters: [] }

interface MeterRun {
  /** First bar and beat of the run. */
  bar: number
  beat: number
  perBar: number
  timeSignature: string
}

interface Knot {
  beat: number
  timeMs: number
}

/** What playback, the editor and the displays read from a grid. */
export interface ClickTimeline {
  /** Beat number of the first click: -(count-in beats), or 0 without a count-in. */
  firstBeat: number
  /** Song time where bar 1 starts. */
  bar1Ms: number
  /** Whether the spacing comes from the points alone (≥ 2 points) - a live tempo nudge then has
   * no effect, the track dictates the tempo. */
  rigid: boolean
  timeOfBeat(beat: number): number
  /** The last beat at or before `timeMs` (may be below `firstBeat`: before the first click). */
  beatAtOrBefore(timeMs: number): number
  /** ms from beat `beat` to the next one. */
  periodAfter(beat: number): number
  beatInBar(beat: number): number
  timeSignatureAt(beat: number): string
  /** Bar number of a beat (count-in bars are 0, -1, …). */
  barOf(beat: number): number
  /** Beat number where bar `bar` starts. */
  barStartBeat(bar: number): number
}

function meterRuns(grid: BeatGrid, timeSignature: string): MeterRun[] {
  const runs: MeterRun[] = [{ bar: 1, beat: 0, perBar: beatsPerBar(timeSignature), timeSignature }]
  for (const change of [...grid.meters].sort((a, b) => a.bar - b.bar)) {
    const prev = runs[runs.length - 1]!
    if (change.bar <= prev.bar) continue
    runs.push({ bar: change.bar, beat: prev.beat + (change.bar - prev.bar) * prev.perBar, perBar: beatsPerBar(change.timeSignature), timeSignature: change.timeSignature })
  }
  return runs
}

function runOfBeat(runs: readonly MeterRun[], beat: number): MeterRun {
  let run = runs[0]!
  for (const r of runs) {
    if (r.beat <= beat) run = r
    else break
  }
  return run
}

function runOfBar(runs: readonly MeterRun[], bar: number): MeterRun {
  let run = runs[0]!
  for (const r of runs) {
    if (r.bar <= bar) run = r
    else break
  }
  return run
}

const mod = (n: number, m: number) => ((n % m) + m) % m

/**
 * The timeline of a variant's grid (or of bar 1 at 0:00 without one), with `countInBars` bars of
 * count-in before bar 1 at the first stretch's spacing.
 */
export function clickTimeline(opts: { beatGrid?: BeatGrid; bpm: number; timeSignature: string; countInBars?: number }): ClickTimeline {
  const grid = opts.beatGrid && opts.beatGrid.points.length > 0 ? opts.beatGrid : DEFAULT_GRID
  const runs = meterRuns(grid, opts.timeSignature)
  const startBeat = (bar: number) => {
    if (bar >= 1) {
      const run = runOfBar(runs, bar)
      return run.beat + (bar - run.bar) * run.perBar
    }
    return (bar - 1) * runs[0]!.perBar // count-in bars use bar 1's meter
  }
  const ks: Knot[] = [...grid.points].sort((a, b) => a.bar - b.bar).map((p) => ({ beat: startBeat(p.bar), timeMs: p.timeMs }))
  const nominal = 60000 / opts.bpm
  const rigid = ks.length >= 2

  const time = (beat: number): number => {
    if (!rigid) return ks[0]!.timeMs + (beat - ks[0]!.beat) * nominal
    let i = 0
    while (i < ks.length - 2 && beat > ks[i + 1]!.beat) i++
    const a = ks[i]!
    const b = ks[i + 1]!
    return a.timeMs + ((beat - a.beat) * (b.timeMs - a.timeMs)) / (b.beat - a.beat)
  }
  const beatOf = (timeMs: number): number => {
    if (!rigid) return ks[0]!.beat + (timeMs - ks[0]!.timeMs) / nominal
    let i = 0
    while (i < ks.length - 2 && timeMs > ks[i + 1]!.timeMs) i++
    const a = ks[i]!
    const b = ks[i + 1]!
    return a.beat + ((timeMs - a.timeMs) * (b.beat - a.beat)) / (b.timeMs - a.timeMs)
  }
  const countInBeats = Math.max(0, opts.countInBars ?? 0) * runs[0]!.perBar
  // Integer beats computed from the fractional inverse can land a hair below an exact beat time.
  const beatAtOrBefore = (timeMs: number) => {
    let beat = Math.floor(beatOf(timeMs) + 1e-9)
    if (time(beat + 1) <= timeMs) beat++
    else if (time(beat) > timeMs) beat--
    return beat
  }

  return {
    firstBeat: countInBeats > 0 ? -countInBeats : 0, // never -0
    bar1Ms: time(0),
    rigid,
    timeOfBeat: time,
    beatAtOrBefore,
    periodAfter: (beat) => time(beat + 1) - time(beat),
    beatInBar: (beat) => {
      if (beat < 0) return mod(beat, runs[0]!.perBar)
      const run = runOfBeat(runs, beat)
      return (beat - run.beat) % run.perBar
    },
    timeSignatureAt: (beat) => (beat < 0 ? runs[0]!.timeSignature : runOfBeat(runs, beat).timeSignature),
    barOf: (beat) => {
      if (beat < 0) return Math.floor(beat / runs[0]!.perBar) + 1
      const run = runOfBeat(runs, beat)
      return run.bar + Math.floor((beat - run.beat) / run.perBar)
    },
    barStartBeat: startBeat,
  }
}

/** Every beat between two song times, for drawing: its time, number, bar and beat-in-bar. */
export function beatsBetween(timeline: ClickTimeline, fromMs: number, toMs: number): { beat: number; timeMs: number; bar: number; beatInBar: number }[] {
  const out: { beat: number; timeMs: number; bar: number; beatInBar: number }[] = []
  const start = Math.max(timeline.firstBeat, timeline.beatAtOrBefore(fromMs))
  for (let beat = start; out.length < 20000; beat++) {
    const timeMs = timeline.timeOfBeat(beat)
    if (timeMs > toMs) break
    if (timeMs >= fromMs) out.push({ beat, timeMs, bar: timeline.barOf(beat), beatInBar: timeline.beatInBar(beat) })
  }
  return out
}

export interface GridStretch {
  fromBar: number
  toBar: number | null
  fromMs: number
  toMs: number | null
  bpm: number
}

/** Tempo of every stretch between two points (one entry with a single point: the variant's bpm). */
export function gridStretches(grid: BeatGrid, bpm: number, timeSignature: string): GridStretch[] {
  const sorted = [...grid.points].sort((a, b) => a.bar - b.bar)
  if (sorted.length === 1) return [{ fromBar: sorted[0]!.bar, toBar: null, fromMs: sorted[0]!.timeMs, toMs: null, bpm }]
  const timeline = clickTimeline({ beatGrid: grid, bpm, timeSignature })
  return sorted.slice(0, -1).map((p, i) => {
    const next = sorted[i + 1]!
    const beats = timeline.barStartBeat(next.bar) - timeline.barStartBeat(p.bar)
    return { fromBar: p.bar, toBar: next.bar, fromMs: p.timeMs, toMs: next.timeMs, bpm: (60000 * beats) / (next.timeMs - p.timeMs) }
  })
}

/** A new grid: bar 1 at `timeMs`. */
export function newGrid(timeMs: number): BeatGrid {
  return { points: [{ id: randomId(), bar: 1, timeMs: Math.max(0, Math.round(timeMs)) }], meters: [] }
}

/**
 * Sets bar `bar` to start at `timeMs`: moves its point, or adds one. Only the bars between the
 * neighbouring points move. Refused (null) when the time is not strictly between the
 * neighbouring points, before 0:00, or would give a stretch outside 20-400 BPM.
 */
export function setPoint(grid: BeatGrid, bar: number, timeMs: number, timeSignature: string): BeatGrid | null {
  const t = Math.round(timeMs)
  if (t < 0 || bar < 1) return null
  const existing = grid.points.find((p) => p.bar === bar)
  const points: GridPoint[] = [...grid.points.filter((p) => p.bar !== bar), { id: existing?.id ?? randomId(), bar, timeMs: t }].sort((a, b) => a.bar - b.bar)
  const timeline = clickTimeline({ beatGrid: { ...grid, points: points.slice(0, 1) }, bpm: 120, timeSignature })
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (b.timeMs <= a.timeMs) return null
    const stretchBpm = (60000 * (timeline.barStartBeat(b.bar) - timeline.barStartBeat(a.bar))) / (b.timeMs - a.timeMs)
    if (stretchBpm < MIN_STRETCH_BPM || stretchBpm > MAX_STRETCH_BPM) return null
  }
  return { ...grid, points }
}

/** Removes a point - never the last one (a grid needs somewhere to start). */
export function removePoint(grid: BeatGrid, id: string): BeatGrid {
  if (grid.points.length <= 1) return grid
  return { ...grid, points: grid.points.filter((p) => p.id !== id) }
}

/** Sets the meter from bar `bar` on (bar ≥ 2; the variant's own meter covers bar 1); `null`
 * removes the change. Points keep their bar numbers - their times stay, only the beats between
 * them are counted differently. */
export function setMeter(grid: BeatGrid, bar: number, timeSignature: string | null): BeatGrid {
  const meters = grid.meters.filter((m) => m.bar !== bar)
  if (timeSignature !== null && bar >= 2) meters.push({ bar, timeSignature })
  return { ...grid, meters: meters.sort((a, b) => a.bar - b.bar) }
}

/** How far, ms, the grid may sit from the detected downbeats before `gridFromBeats` adds a point
 * - measured as the median over ±2 downbeats, so a single detection off by the detector's own
 * scatter (music-tempo: 17-45 ms, docs/13) doesn't earn a point of its own. Tuned on What's Up
 * against its drum hits (2026-09-27): 30 ms without the median gave 60 points, this 23, with 85.7
 * instead of 87.0 % of the beats within 50 ms of a hit and the same 3 red bars. */
const DETECTION_TOLERANCE_MS = 40
const DETECTION_SMOOTHING = 2

/**
 * A grid from automatically detected beats ("Track analysieren"): bar 1 on the first detected
 * downbeat, then as few points as keep the detected downbeats within 40 ms of the grid
 * (Douglas-Peucker over bar number and time, on the local median deviation) - a track recorded to a click comes out with two
 * points, a drifting one with a handful, each a bar line the musician can see and move. Gaps are
 * counted in beats of the detected tempo, so a missed detection - or the built-in detector's
 * sparse output, which only reports beats where its grid needed correcting - doesn't shift the
 * bar count. Null without a detected downbeat.
 */
export function gridFromBeats(beats: readonly { timeMs: number; beatInBar?: number }[], bpm: number, timeSignature: string): BeatGrid | null {
  const sorted = [...beats].sort((a, b) => a.timeMs - b.timeMs)
  const first = sorted.findIndex((b) => (b.beatInBar ?? 0) === 0)
  if (first < 0) return null
  const from = sorted.slice(first)
  const period = 60000 / bpm
  const perBar = beatsPerBar(timeSignature)
  const downbeats: { bar: number; timeMs: number }[] = []
  let beat = 0
  from.forEach((b, i) => {
    if (i > 0) beat += Math.max(1, Math.round((b.timeMs - from[i - 1]!.timeMs) / period))
    if (beat % perBar === 0) downbeats.push({ bar: beat / perBar + 1, timeMs: Math.round(b.timeMs) })
  })
  const keep = new Set([0, downbeats.length - 1])
  const simplify = (lo: number, hi: number) => {
    if (hi - lo < 2) return
    const a = downbeats[lo]!
    const b = downbeats[hi]!
    const deviation = (i: number) => downbeats[i]!.timeMs - (a.timeMs + ((downbeats[i]!.bar - a.bar) * (b.timeMs - a.timeMs)) / (b.bar - a.bar))
    let worst = -1
    let worstDistance = DETECTION_TOLERANCE_MS
    for (let i = lo + 1; i < hi; i++) {
      const window: number[] = []
      for (let k = Math.max(lo + 1, i - DETECTION_SMOOTHING); k <= Math.min(hi - 1, i + DETECTION_SMOOTHING); k++) window.push(deviation(k))
      window.sort((x, y) => x - y)
      const distance = Math.abs(window[Math.floor(window.length / 2)]!)
      if (distance > worstDistance) [worst, worstDistance] = [i, distance]
    }
    // The point goes where the median is worst, not on the single furthest detection: that one is
    // often just detector scatter (tried on What's Up: 9 red bars instead of 3). At a sharp tempo
    // change this can land a bar early, with a second point after it - harmless.
    if (worst < 0) return
    keep.add(worst)
    simplify(lo, worst)
    simplify(worst, hi)
  }
  simplify(0, downbeats.length - 1)
  const points = [...keep].sort((a, b) => a - b).map((i) => ({ id: randomId(), bar: downbeats[i]!.bar, timeMs: downbeats[i]!.timeMs }))
  return { points, meters: [] }
}

/**
 * Tempo from taps along the song: the slope of a least-squares line through them, after
 * counting each gap in beats against the median gap (a missed tap = a gap of 2). The device's
 * tap latency only shifts that line, it doesn't tilt it - the grid's position comes from bar 1
 * set by eye. Null with fewer than 4 taps.
 */
export function tempoFromTaps(tapsMs: readonly number[]): number | null {
  const taps = [...tapsMs].sort((a, b) => a - b)
  if (taps.length < 4) return null
  const gaps = taps.slice(1).map((t, i) => t - taps[i]!).filter((g) => g > 0)
  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  const indices = [0]
  for (let i = 1; i < taps.length; i++) indices.push(indices[i - 1]! + Math.max(1, Math.round((taps[i]! - taps[i - 1]!) / median)))
  const n = taps.length
  const mx = indices.reduce((s, x) => s + x, 0) / n
  const my = taps.reduce((s, y) => s + y, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (indices[i]! - mx) * (taps[i]! - my)
    sxx += (indices[i]! - mx) ** 2
  }
  if (sxx === 0) return null
  const periodMs = sxy / sxx
  return periodMs > 0 ? Math.round((60000 / periodMs) * 10) / 10 : null
}

export type SectionTempoResult =
  | { kind: 'bpm' }
  | { kind: 'grid'; grid: BeatGrid; startBar: number; endBar: number; nextBar: number | null }
  | { kind: 'refused'; reason: string }

/**
 * "Tempo tippen" from somewhere in the song (#329): the tapped `tempo` applies from the bar where
 * tapping started, up to the next alignment point - points before it, and the next point itself,
 * stay. Tap *positions* are never used as alignment points: taps arrive late by the device's
 * audio/touch delay (docs/13 §7, hundreds of ms on some tablets) - only the tempo, the slope
 * through them, is reliable. So the starting bar stays where the grid has it, and a second point
 * at the bar the taps reached (`endBar`) carries the new tempo; after it, the tempo carries on
 * unless a later point bridges back. Tapping from the only point with nothing after it just sets
 * the song's bpm (`kind: 'bpm'`), as for the whole song.
 */
export function applySectionTempo(grid: BeatGrid, bpm: number, timeSignature: string, tapsMs: readonly number[], tempo: number): SectionTempoResult {
  const timeline = clickTimeline({ beatGrid: grid, bpm, timeSignature })
  const taps = [...tapsMs].sort((a, b) => a - b)
  const points = [...grid.points].sort((a, b) => a.bar - b.bar)
  const startBar = Math.max(1, timeline.barOf(timeline.beatAtOrBefore(taps[0]!)))
  const next = points.find((p) => p.bar > startBar) ?? null
  if (!next && points.length === 1 && startBar <= points[0]!.bar) return { kind: 'bpm' }

  const startMs = timeline.timeOfBeat(timeline.barStartBeat(startBar))
  const beatMs = 60000 / tempo
  const perBar = timeline.barStartBeat(startBar + 1) - timeline.barStartBeat(startBar)
  let endBar = startBar + Math.max(1, Math.ceil((taps[taps.length - 1]! - startMs) / beatMs / perBar))
  if (next && endBar >= next.bar) endBar = next.bar - 1
  if (endBar <= startBar) return { kind: 'refused', reason: `Zwischen Takt ${startBar} und dem nächsten Ausrichtungspunkt (Takt ${next?.bar}) ist kein Platz für ein eigenes Tempo.` }
  const endMs = startMs + (timeline.barStartBeat(endBar) - timeline.barStartBeat(startBar)) * beatMs

  const pinned = setPoint(grid, startBar, startMs, timeSignature)
  const withTempo = pinned && setPoint(pinned, endBar, endMs, timeSignature)
  if (!withTempo) return { kind: 'refused', reason: `${tempo.toFixed(1)} BPM ab Takt ${startBar} passt nicht zum nächsten Ausrichtungspunkt (Takt ${next?.bar}) - dort zuerst die Ausrichtung prüfen.` }
  return { kind: 'grid', grid: withTempo, startBar, endBar, nextBar: next?.bar ?? null }
}
