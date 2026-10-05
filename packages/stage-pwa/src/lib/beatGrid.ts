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

/** One stretch between two knots: beat spacing `p0` at its start, `p1` at its end, changing
 * linearly in between (equal for a constant stretch). */
interface Stretch {
  a: Knot
  b: Knot
  p0: number
  p1: number
}

const MIN_PERIOD = 60000 / MAX_STRETCH_BPM
const MAX_PERIOD = 60000 / MIN_STRETCH_BPM

/**
 * Beat spacing per stretch (#354). Constant stretches: the average. A gradual one starts at the
 * tempo the song arrives with (the previous stretch's end) and changes linearly so that the
 * stretch still ends exactly on the next point: with spacing p(x) = p0 + (p1 - p0)·x/N over N
 * beats the length is N·(p0 + p1)/2. A gradual first stretch ends at the following constant
 * stretch's tempo instead. Where neither neighbour exists, or the result leaves the tempo limits,
 * it stays constant.
 */
function stretchesOf(ks: readonly Knot[], gradual: readonly boolean[]): Stretch[] {
  const avg = ks.slice(0, -1).map((k, i) => (ks[i + 1]!.timeMs - k.timeMs) / (ks[i + 1]!.beat - k.beat))
  const out: Stretch[] = []
  for (let i = 0; i < avg.length; i++) {
    const a = ks[i]!
    const b = ks[i + 1]!
    let p0 = avg[i]!
    let p1 = avg[i]!
    if (gradual[i]) {
      if (i > 0) {
        p0 = out[i - 1]!.p1
        p1 = 2 * avg[i]! - p0
      } else if (i + 1 < avg.length && !gradual[i + 1]) {
        p1 = avg[i + 1]!
        p0 = 2 * avg[i]! - p1
      }
      const ok = (p: number) => p >= MIN_PERIOD && p <= MAX_PERIOD
      if (!ok(p0) || !ok(p1)) {
        p0 = avg[i]!
        p1 = avg[i]!
      }
    }
    out.push({ a, b, p0, p1 })
  }
  return out
}

/** Song time of beat position `x` beats after the stretch start (may lie outside the stretch:
 * before it the start spacing, after it the end spacing carries on). */
function timeInStretch(s: Stretch, beat: number): number {
  const n = s.b.beat - s.a.beat
  const x = beat - s.a.beat
  if (x <= 0) return s.a.timeMs + x * s.p0
  if (x >= n) return s.b.timeMs + (x - n) * s.p1
  return s.a.timeMs + s.p0 * x + ((s.p1 - s.p0) * x * x) / (2 * n)
}

/** Inverse of timeInStretch: the (fractional) beat at song time `timeMs`. */
function beatInStretch(s: Stretch, timeMs: number): number {
  const n = s.b.beat - s.a.beat
  if (timeMs <= s.a.timeMs) return s.a.beat + (timeMs - s.a.timeMs) / s.p0
  if (timeMs >= s.b.timeMs) return s.b.beat + (timeMs - s.b.timeMs) / s.p1
  const dt = timeMs - s.a.timeMs
  const k = (s.p1 - s.p0) / n
  if (Math.abs(k) < 1e-12) return s.a.beat + dt / s.p0
  return s.a.beat + (-s.p0 + Math.sqrt(s.p0 * s.p0 + 2 * k * dt)) / k
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
  const sortedPoints = [...grid.points].sort((a, b) => a.bar - b.bar)
  const ks: Knot[] = sortedPoints.map((p) => ({ beat: startBeat(p.bar), timeMs: p.timeMs }))
  const nominal = 60000 / opts.bpm
  const rigid = ks.length >= 2
  const stretches = rigid ? stretchesOf(ks, sortedPoints.map((p) => p.gradual === true)) : []

  const time = (beat: number): number => {
    if (!rigid) return ks[0]!.timeMs + (beat - ks[0]!.beat) * nominal
    let i = 0
    while (i < stretches.length - 1 && beat > stretches[i]!.b.beat) i++
    return timeInStretch(stretches[i]!, beat)
  }
  const beatOf = (timeMs: number): number => {
    if (!rigid) return ks[0]!.beat + (timeMs - ks[0]!.timeMs) / nominal
    let i = 0
    while (i < stretches.length - 1 && timeMs > stretches[i]!.b.timeMs) i++
    return beatInStretch(stretches[i]!, timeMs)
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
  /** Average tempo of the stretch. */
  bpm: number
  /** Tempo at its start and end - differ only for a gradual stretch (#354). */
  startBpm: number
  endBpm: number
  gradual: boolean
}

/** Tempo of every stretch between two points (one entry with a single point: the variant's bpm). */
export function gridStretches(grid: BeatGrid, bpm: number, timeSignature: string): GridStretch[] {
  const sorted = [...grid.points].sort((a, b) => a.bar - b.bar)
  if (sorted.length === 1) return [{ fromBar: sorted[0]!.bar, toBar: null, fromMs: sorted[0]!.timeMs, toMs: null, bpm, startBpm: bpm, endBpm: bpm, gradual: false }]
  const timeline = clickTimeline({ beatGrid: grid, bpm, timeSignature })
  return sorted.slice(0, -1).map((p, i) => {
    const next = sorted[i + 1]!
    const startBeat = timeline.barStartBeat(p.bar)
    const endBeat = timeline.barStartBeat(next.bar)
    const beats = endBeat - startBeat
    const startBpm = 60000 / timeline.periodAfter(startBeat)
    const endBpm = 60000 / timeline.periodAfter(endBeat - 1)
    return {
      fromBar: p.bar,
      toBar: next.bar,
      fromMs: p.timeMs,
      toMs: next.timeMs,
      bpm: (60000 * beats) / (next.timeMs - p.timeMs),
      startBpm,
      endBpm,
      gradual: p.gradual === true && Math.abs(startBpm - endBpm) > 0.05,
    }
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
  // A moved point keeps its other properties (e.g. `gradual`, #354).
  const points: GridPoint[] = [...grid.points.filter((p) => p.bar !== bar), { ...existing, id: existing?.id ?? randomId(), bar, timeMs: t }].sort((a, b) => a.bar - b.bar)
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

/** Marks the stretch starting at point `pointId` as gradual (#354) or constant again. */
export function setGradual(grid: BeatGrid, pointId: string, gradual: boolean): BeatGrid {
  return {
    ...grid,
    points: grid.points.map((p) => {
      if (p.id !== pointId) return p
      const plain: GridPoint = { id: p.id, bar: p.bar, timeMs: p.timeMs }
      return gradual ? { ...plain, gradual: true } : plain
    }),
  }
}

export type TapTrend =
  | { kind: 'steady'; bpm: number }
  | { kind: 'gradual'; startBpm: number; endBpm: number }
  | { kind: 'unsteady'; startBpm: number; endBpm: number }

/**
 * Whether tapped beats change tempo (#354). Fits tap time = a + b·i + c·i² over the beat index i
 * (missed taps counted like tempoFromTaps); the beat spacing is then b + 2c·i, so its value at the
 * first and last tap gives start and end tempo.
 * - `steady`: start and end differ by less than ~4 % - one tempo, as before.
 * - `gradual`: a clear change, and the curve explains the taps (residual within tapping jitter).
 * - `unsteady`: the tempo changes, but not evenly enough for one gradual stretch.
 */
export function tempoTrendFromTaps(tapsMs: readonly number[]): TapTrend | null {
  const steadyBpm = tempoFromTaps(tapsMs)
  if (steadyBpm === null) return null
  const taps = [...tapsMs].sort((x, y) => x - y)
  if (taps.length < 6) return { kind: 'steady', bpm: steadyBpm }
  const gaps = taps.slice(1).map((t, i) => t - taps[i]!)
  const median = [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)]!
  const idx = [0]
  for (let i = 1; i < taps.length; i++) idx.push(idx[i - 1]! + Math.max(1, Math.round((taps[i]! - taps[i - 1]!) / median)))
  // Least squares for t = a + b i + c i^2 (normal equations, centred for stability).
  const n = taps.length
  const mi = idx.reduce((s, x) => s + x, 0) / n
  const mt = taps.reduce((s, x) => s + x, 0) / n
  let s11 = 0, s12 = 0, s22 = 0, s1y = 0, s2y = 0
  const xs = idx.map((x) => x - mi)
  const x2m = xs.reduce((s, x) => s + x * x, 0) / n
  for (let i = 0; i < n; i++) {
    const x1 = xs[i]!
    const x2 = x1 * x1 - x2m
    const y = taps[i]! - mt
    s11 += x1 * x1; s12 += x1 * x2; s22 += x2 * x2; s1y += x1 * y; s2y += x2 * y
  }
  const det = s11 * s22 - s12 * s12
  if (Math.abs(det) < 1e-9) return { kind: 'steady', bpm: steadyBpm }
  const b = (s1y * s22 - s2y * s12) / det
  const c = (s2y * s11 - s1y * s12) / det
  const periodAt = (i: number) => b + 2 * c * (i - mi)
  const p0 = periodAt(idx[0]!)
  const p1 = periodAt(idx[n - 1]!)
  if (p0 <= 0 || p1 <= 0) return { kind: 'steady', bpm: steadyBpm }
  const startBpm = Math.round((60000 / p0) * 10) / 10
  const endBpm = Math.round((60000 / p1) * 10) / 10
  if (Math.abs(endBpm - startBpm) / ((startBpm + endBpm) / 2) < 0.04) return { kind: 'steady', bpm: steadyBpm }
  // Residual of the curve vs. a typical tapping jitter (~30 ms RMS).
  let sse = 0
  for (let i = 0; i < n; i++) {
    const x1 = xs[i]!
    const fit = mt + b * x1 + c * (x1 * x1 - x2m)
    sse += (taps[i]! - fit) ** 2
  }
  const rms = Math.sqrt(sse / n)
  return rms <= 35 ? { kind: 'gradual', startBpm, endBpm } : { kind: 'unsteady', startBpm, endBpm }
}

/**
 * Applies a tapped ritardando/accelerando (#354): like applySectionTempo the starting bar keeps
 * its grid position (tap positions arrive late, docs/13 §7); it becomes a gradual point, and the
 * bar the taps reached gets a point placed so the stretch ends at the tapped end tempo - starting
 * from the tempo the song arrives with, as every gradual stretch does.
 */
export function applySectionRamp(grid: BeatGrid, bpm: number, timeSignature: string, tapsMs: readonly number[], endBpm: number): SectionTempoResult {
  const timeline = clickTimeline({ beatGrid: grid, bpm, timeSignature })
  const taps = [...tapsMs].sort((a, b) => a - b)
  const points = [...grid.points].sort((a, b) => a.bar - b.bar)
  const startBar = Math.max(1, timeline.barOf(timeline.beatAtOrBefore(taps[0]!)))
  const next = points.find((p) => p.bar > startBar) ?? null
  const startBeat = timeline.barStartBeat(startBar)
  const startMs = timeline.timeOfBeat(startBeat)
  const p0 = timeline.periodAfter(startBeat - 1)
  const p1 = 60000 / endBpm
  const perBar = timeline.barStartBeat(startBar + 1) - startBeat
  const avg = (p0 + p1) / 2
  let endBar = startBar + Math.max(1, Math.ceil((taps[taps.length - 1]! - startMs) / avg / perBar))
  if (next && endBar >= next.bar) endBar = next.bar - 1
  if (endBar <= startBar) return { kind: 'refused', reason: `Zwischen Takt ${startBar} und dem nächsten Ausrichtungspunkt (Takt ${next?.bar}) ist kein Platz für eine Tempoänderung.` }
  const beats = timeline.barStartBeat(endBar) - startBeat
  const endMs = startMs + beats * avg
  const pinned = setPoint(grid, startBar, startMs, timeSignature)
  const withEnd = pinned && setPoint(pinned, endBar, Math.round(endMs), timeSignature)
  if (!withEnd) return { kind: 'refused', reason: `Die Tempoänderung ab Takt ${startBar} passt nicht zum nächsten Ausrichtungspunkt (Takt ${next?.bar}).` }
  const startPoint = withEnd.points.find((p) => p.bar === startBar)!
  return { kind: 'grid', grid: setGradual(withEnd, startPoint.id, true), startBar, endBar, nextBar: next?.bar ?? null }
}

