import type { BeatGrid, GridPoint } from 'shared-types'
import { clickTimeline, gridStretches, MAX_STRETCH_BPM, MIN_STRETCH_BPM, setPoint } from './beatGrid'

/**
 * "Tempo tippen" through a passage whose tempo moves (#354, Marco: "detect the BPMs over time,
 * smooth that, then apply the grid"):
 *
 * 1. **Observations** - the taps, counted in beats (a missed tap = a gap of 2, against a spacing
 *    that follows the tempo as it moves).
 * 2. **Tempo curve** - a local quadratic fit per beat, for the preview: shows where it gets slower
 *    or faster before anything changes. A quadratic is what an even tempo change looks like in
 *    time, so the curve follows a ritardando without lag (a local *linear* fit lagged ~45 ms).
 * 3. **Grid** - the grid model itself (stretches between bar starts, each constant or gradual, the
 *    gradual model of beatGrid.ts) fitted straight to the raw taps by least squares; the simplest
 *    split that explains them wins. The result is ordinary visible points - the curve is never
 *    stored (docs/14 §5a: the invisible smoothing of the old anchor model was not editable).
 *
 * Measured against a synthetic ritardando 120 → 90 BPM / accelerando 100 → 130 BPM over 4 bars
 * (tempoCurve.test.ts): taps with ±15 ms jitter and 200 ms delay land the grid typically within
 * ~25 ms of the real beats, at worst ~55 ms; one average tempo was up to 1.6 s off.
 */

/** Half-width of the smoothing window in beats: ±6 beats spans three bars of 4/4 - enough to
 * average tapping jitter (~30 ms) down to a few ms, short enough to follow a 2-bar ritardando. */
const SMOOTHING_HALF_WIDTH = 6
/** At least this many observations in a window (wider where detections are sparse). */
const MIN_WINDOW_OBSERVATIONS = 8

export interface BeatObservation {
  /** Beat number, counted from the first observation (0) - gaps already counted in beats. */
  beat: number
  timeMs: number
}

export interface TempoCurvePoint {
  beat: number
  /** Smoothed time of the beat. */
  timeMs: number
  /** Tempo at the beat (from the smoothed spacing). */
  bpm: number
}

/** Counts each gap in beats against the median gap (a missed tap = 2), like tempoFromTaps. */
export function observationsFromTimes(timesMs: readonly number[], periodMs?: number): BeatObservation[] {
  const times = [...timesMs].sort((a, b) => a - b)
  if (times.length === 0) return []
  const gaps = times
    .slice(1)
    .map((t, i) => t - times[i]!)
    .filter((g) => g > 0)
  const period = periodMs ?? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 500
  // The spacing follows the tempo as it moves: against a fixed spacing a missed beat in a 25 %
  // slower passage counted as 3 beats instead of 2 and shifted everything after it by a bar.
  let current = period
  const out: BeatObservation[] = [{ beat: 0, timeMs: times[0]! }]
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!
    const beats = Math.max(1, Math.round(gap / current))
    out.push({ beat: out[i - 1]!.beat + beats, timeMs: times[i]! })
    const perBeat = gap / beats
    if (perBeat > current * 0.75 && perBeat < current * 1.33) current = current * 0.7 + perBeat * 0.3
  }
  return out
}

/** Weighted least squares t = a + b·x + c·x² around `at`; returns [a, b] (time and spacing at `at`). */
function localQuadratic(obs: readonly BeatObservation[], at: number, halfWidth: number): [number, number] | null {
  const s = [0, 0, 0, 0, 0]
  const sy = [0, 0, 0]
  for (const o of obs) {
    const x = o.beat - at
    const u = Math.abs(x) / (halfWidth + 1)
    if (u >= 1) continue
    const w = (1 - u * u * u) ** 3
    const y = o.timeMs
    let xp = w
    for (let k = 0; k < 5; k++) {
      s[k]! += xp
      if (k < 3) sy[k]! += xp * y
      xp *= x
    }
  }
  // Normal equations [[s0 s1 s2][s1 s2 s3][s2 s3 s4]]·[a b c] = [sy0 sy1 sy2], by Cramer's rule.
  const [s0, s1, s2, s3, s4] = s as [number, number, number, number, number]
  const [y0, y1, y2] = sy as [number, number, number]
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2)
  if (Math.abs(det) < 1e-9) return null
  const a = (y0 * (s2 * s4 - s3 * s3) - s1 * (y1 * s4 - s3 * y2) + s2 * (y1 * s3 - s2 * y2)) / det
  const b = (s0 * (y1 * s4 - y2 * s3) - y0 * (s1 * s4 - s3 * s2) + s2 * (s1 * y2 - y1 * s2)) / det
  return [a, b]
}

/** The smoothed tempo curve: one point per beat from the first to the last observation. */
export function tempoCurve(obs: readonly BeatObservation[]): TempoCurvePoint[] {
  if (obs.length < 4) return []
  const last = obs[obs.length - 1]!.beat
  const out: TempoCurvePoint[] = []
  for (let beat = 0; beat <= last; beat++) {
    // Widen the window where observations are sparse (a detector that skips beats).
    let half = SMOOTHING_HALF_WIDTH
    while (half < 64 && obs.filter((o) => Math.abs(o.beat - beat) <= half).length < MIN_WINDOW_OBSERVATIONS) half += 2
    const fit = localQuadratic(obs, beat, half)
    if (!fit || fit[1] <= 0) continue
    out.push({ beat, timeMs: fit[0], bpm: 60000 / fit[1] })
  }
  return out
}

const MIN_PERIOD = 60000 / MAX_STRETCH_BPM
const MAX_PERIOD = 60000 / MIN_STRETCH_BPM

/** Linear form over the unknowns of segmentedFit: coefficients for τ1..τm, c, then a constant. */
type Form = number[]

/**
 * Fits the grid model straight to the raw observations (#354): knots at `knotBeats` (bar starts),
 * stretch i constant or gradual, gradual ones starting at the spacing they arrive with. Every beat
 * time is linear in the unknown knot times τ1..τm (τ0 = 0) and the overall position c (tap delay
 * included), so one least-squares solve gives them. Returns the knot times relative to knot 0 and
 * the residual sum of squares.
 */
function segmentedFit(
  obs: readonly BeatObservation[],
  knotBeats: readonly number[],
  gradual: readonly boolean[],
  arrivingPeriod: number,
): { tau: number[]; rss: number; residuals: number[] } | null {
  const m = knotBeats.length - 1
  const size = m + 2
  const zero = (): Form => new Array(size).fill(0)
  const tau = (i: number): Form => {
    const f = zero()
    if (i > 0) f[i - 1] = 1
    return f
  }
  const add = (a: Form, b: Form, k = 1): Form => a.map((v, i) => v + k * b[i]!)
  const scale = (a: Form, k: number): Form => a.map((v) => v * k)
  const constant = (v: number): Form => {
    const f = zero()
    f[size - 1] = v
    return f
  }
  const p0: Form[] = []
  const p1: Form[] = []
  for (let i = 0; i < m; i++) {
    const n = knotBeats[i + 1]! - knotBeats[i]!
    const avg = scale(add(tau(i + 1), tau(i), -1), 1 / n)
    if (gradual[i]) {
      p0.push(i === 0 ? constant(arrivingPeriod) : p1[i - 1]!)
      p1.push(add(scale(avg, 2), p0[i]!, -1))
    } else {
      p0.push(avg)
      p1.push(avg)
    }
  }
  const c = zero()
  c[m] = 1
  const rows: Form[] = []
  const ys: number[] = []
  for (const o of obs) {
    const x = o.beat
    let f: Form
    if (x <= knotBeats[0]!) f = add(c, p0[0]!, x - knotBeats[0]!)
    else if (x >= knotBeats[m]!) f = add(add(c, tau(m)), p1[m - 1]!, x - knotBeats[m]!)
    else {
      let i = 0
      while (x > knotBeats[i + 1]!) i++
      const n = knotBeats[i + 1]! - knotBeats[i]!
      const u = x - knotBeats[i]!
      f = add(add(add(c, tau(i)), p0[i]!, u), add(p1[i]!, p0[i]!, -1), (u * u) / (2 * n))
    }
    rows.push(f)
    ys.push(o.timeMs - f[size - 1]!)
  }
  // Normal equations over the first size-1 coefficients (the last one is the constant).
  const k = size - 1
  const A: number[][] = Array.from({ length: k }, () => new Array(k + 1).fill(0))
  rows.forEach((r, j) => {
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a]![b]! += r[a]! * r[b]!
      A[a]![k]! += r[a]! * ys[j]!
    }
  })
  for (let col = 0; col < k; col++) {
    let pivot = col
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[pivot]![col]!)) pivot = r
    if (Math.abs(A[pivot]![col]!) < 1e-9) return null
    ;[A[col], A[pivot]] = [A[pivot]!, A[col]!]
    for (let r = 0; r < k; r++) {
      if (r === col) continue
      const factor = A[r]![col]! / A[col]![col]!
      for (let q = col; q <= k; q++) A[r]![q]! -= factor * A[col]![q]!
    }
  }
  const theta = A.map((row, i) => row[k]! / row[i]!)
  const residuals = rows.map((r, j) => {
    let t = 0
    for (let a = 0; a < k; a++) t += r[a]! * theta[a]!
    return ys[j]! - t
  })
  const rss = residuals.reduce((sum, e) => sum + e * e, 0)
  for (let i = 0; i < m; i++) {
    const ok = (f: Form) => {
      let v = f[size - 1]!
      for (let a = 0; a < k; a++) v += f[a]! * theta[a]!
      return v >= MIN_PERIOD && v <= MAX_PERIOD
    }
    if (!ok(p0[i]!) || !ok(p1[i]!)) return null
  }
  return { tau: [0, ...theta.slice(0, m)], rss, residuals }
}

/** The finest timing a tap can carry - fits closer than this count the same. */
const TAP_PRECISION_MS = 10

/** Most stretches tried for one tapped passage - a ritardando is "steady, change, steady". */
const MAX_TAPPED_STRETCHES = 4

/**
 * The simplest split of a tapped passage that explains the taps: every choice of up to
 * MAX_TAPPED_STRETCHES stretches between bar starts, each constant or gradual, fitted to the raw
 * taps; the winner by BIC (residual vs. number of knots and gradual stretches) - so tapping jitter
 * doesn't buy points, and a real change does.
 */
function bestTappedSplit(
  obs: readonly BeatObservation[],
  barBeats: readonly number[],
  arrivingPeriod: number,
): { knots: number[]; gradual: boolean[]; tau: number[] } | null {
  const first = searchSplit(obs, barBeats, arrivingPeriod)
  if (!first) return null
  // One stray tap (a flam, a late reaction) pulls a least-squares fit by tens of ms: drop taps
  // further off than 3× the typical deviation (MAD) and search again.
  const sortedAbs = first.residuals.map(Math.abs).sort((a, b) => a - b)
  const sigma = 1.4826 * sortedAbs[Math.floor(sortedAbs.length / 2)]!
  const limit = Math.max(2.5 * sigma, 25)
  const kept = obs.filter((_, i) => Math.abs(first.residuals[i]!) <= limit)
  if (kept.length < 8) return first
  return searchSplit(kept, barBeats, arrivingPeriod, limit * limit) ?? first
}

function searchSplit(
  obs: readonly BeatObservation[],
  barBeats: readonly number[],
  arrivingPeriod: number,
  cap: number | null = null,
): {
  knots: number[]
  gradual: boolean[]
  tau: number[]
  residuals: number[]
} | null {
  const n = obs.length
  const inner = barBeats.slice(1, -1).map((_, i) => i + 1)
  let best: {
    score: number
    knots: number[]
    gradual: boolean[]
    tau: number[]
    residuals: number[]
  } | null = null
  const tryKnots = (knotIdx: number[]) => {
    const knotBeats = knotIdx.map((i) => barBeats[i]!)
    const stretches = knotIdx.length - 1
    for (let mask = 0; mask < 1 << stretches; mask++) {
      const gradual = Array.from({ length: stretches }, (_, i) => (mask & (1 << i)) !== 0)
      const fit = segmentedFit(obs, knotBeats, gradual, arrivingPeriod)
      if (!fit) continue
      // A gradual stretch has no free number of its own (it starts at the arriving tempo), so it
      // costs nothing extra - counted like a knot, four constant pieces tied with "steady, ramp,
      // steady" and won on noise (tried 0 / 0.25 / 0.5: 0 was best over 30 tapped runs).
      const params = stretches + 1
      // Scored on a bounded error (each tap counts at most like one 2.5σ miss), so a cluster of
      // wild taps can't buy a point; a real tempo change misses on many taps and still does.
      const rss = cap === null ? fit.rss : fit.residuals.reduce((sum, e) => sum + Math.min(e * e, cap), 0)
      // Nobody taps tighter than ~10 ms: below that a closer fit is no better, so very even
      // taps (or a script) don't buy points for timer noise.
      const score = n * Math.log(Math.max(rss, n * TAP_PRECISION_MS ** 2) / n) + params * Math.log(n)
      if (!best || score < best.score)
        best = {
          score,
          knots: knotIdx,
          gradual,
          tau: fit.tau,
          residuals: fit.residuals,
        }
    }
  }
  const choose = (from: number, picked: number[]) => {
    tryKnots([0, ...picked, barBeats.length - 1])
    if (picked.length + 1 >= MAX_TAPPED_STRETCHES) return
    for (let i = from; i < inner.length; i++) choose(i + 1, [...picked, inner[i]!])
  }
  choose(0, [])
  return best
}

export type CurveGridResult =
  | {
      kind: 'grid'
      grid: BeatGrid
      startBar: number
      endBar: number
      startBpm: number
      endBpm: number
      /** Points the fit added or moved, between startBar and endBar. */
      pointCount: number
      /** The smoothed curve, as song times - for the preview. */
      curve: { timeMs: number; bpm: number }[]
    }
  | { kind: 'steady' }
  | { kind: 'refused'; reason: string }

/** Below this change between the slowest and fastest smoothed tempo a passage counts as steady. */
const STEADY_SPREAD = 0.03

/**
 * "Tempo tippen" through a passage whose tempo moves (#354): the grid follows the smoothed tapped
 * curve. Tap *positions* arrive late by the device's delay (docs/13 §7) - only their spacing is
 * used: the bar where tapping started keeps its grid position and the curve is hung from it. Points
 * between that bar and the last fully tapped bar are replaced; points outside stay, and the passage
 * ends before the next point after it. `steady` when the taps don't change tempo (the caller keeps
 * its one-tempo path).
 */
export function gridFromTappedCurve(grid: BeatGrid, bpm: number, timeSignature: string, tapsMs: readonly number[]): CurveGridResult {
  const obs = observationsFromTimes(tapsMs)
  const curve = tempoCurve(obs)
  if (curve.length < 4) return { kind: 'steady' }
  const bpms = curve.map((c) => c.bpm)
  const lo = Math.min(...bpms)
  const hi = Math.max(...bpms)
  if ((hi - lo) / ((hi + lo) / 2) < STEADY_SPREAD) return { kind: 'steady' }

  // Where the tapping starts is read from the grid *before* it: points inside the tapped passage
  // are about to be replaced, and an earlier attempt may have left them wrong - read through them,
  // the start landed a bar off and the passage was cut short at the first of them (Marco,
  // 2026-10-08: the amber curve right, the applied grid 176 / 164 / 98 BPM).
  const firstTap = tapsMs.length ? Math.min(...tapsMs) : 0
  const before: BeatGrid = { ...grid, points: grid.points.filter((p) => p.timeMs < firstTap - 50) }
  const timeline = clickTimeline({ beatGrid: before.points.length > 0 ? before : grid, bpm, timeSignature })
  // The beat the first tap belongs to: taps are late, never early by more than jitter.
  const firstGridBeat = timeline.beatAtOrBefore(firstTap + 30)
  const startBar = Math.max(1, timeline.barOf(firstGridBeat) + (timeline.beatInBar(firstGridBeat) === 0 ? 0 : 1))
  const startBeat = timeline.barStartBeat(startBar)
  const curveAt = (gridBeat: number) => curve.find((c) => c.beat === gridBeat - firstGridBeat)
  const startPoint = curveAt(startBeat)
  if (!startPoint)
    return {
      kind: 'refused',
      reason: 'Zu wenige Schläge getippt - mindestens zwei Takte lang mittippen.',
    }

  // The curve as song times, hung from the start bar's current position (for the preview).
  const offset = timeline.timeOfBeat(startBeat) - startPoint.timeMs
  const lastTapped = curve[curve.length - 1]!.beat + firstGridBeat - startBeat
  const points = [...grid.points].sort((a, b) => a.bar - b.bar)
  // Every bar tapped through belongs to the passage - old points inside it are replaced, the
  // passage no longer stops at the first of them.
  const barBeats: number[] = []
  for (let bar = startBar; ; bar++) {
    const rel = timeline.barStartBeat(bar) - startBeat
    if (rel > lastTapped) break
    barBeats.push(rel)
  }
  if (barBeats.length < 2) {
    return { kind: 'refused', reason: 'Zu wenige Schläge getippt - mindestens zwei Takte lang mittippen.' }
  }
  const endBar = startBar + barBeats.length - 1
  const next = points.find((p) => p.bar > endBar) ?? null
  // Observations on the grid's beat numbers relative to the start bar; fitted on the raw taps.
  const relObs = obs.map((o) => ({
    beat: o.beat + firstGridBeat - startBeat,
    timeMs: o.timeMs,
  }))
  const split = bestTappedSplit(relObs, barBeats, timeline.periodAfter(startBeat - 1))
  if (!split)
    return {
      kind: 'refused',
      reason: 'Aus den Tipps ließ sich kein Raster bilden - noch einmal gleichmäßiger mittippen.',
    }

  // Keep the points outside the passage; the passage gets the fitted ones, hung from the start bar.
  const startTime = timeline.timeOfBeat(startBeat)
  let result: BeatGrid | null = {
    ...grid,
    points: points.filter((p) => p.bar < startBar || p.bar > endBar),
  }
  split.knots.forEach((k, i) => {
    if (result) result = setPoint(result, startBar + k, startTime + split.tau[i]!, timeSignature)
  })
  if (!result)
    return {
      kind: 'refused',
      reason: `Die Tempoänderung ab Takt ${startBar} passt nicht zum nächsten Ausrichtungspunkt (Takt ${next?.bar}).`,
    }
  const gradualFrom = new Set(
    split.knots
      .slice(0, -1)
      .filter((_, i) => split.gradual[i])
      .map((k) => startBar + k),
  )
  const fitted: BeatGrid = result
  const finalGrid: BeatGrid = {
    ...fitted,
    points: fitted.points.map((p): GridPoint => {
      const plain: GridPoint = { id: p.id, bar: p.bar, timeMs: p.timeMs }
      if (p.bar < startBar || p.bar > endBar) return p
      return gradualFrom.has(p.bar) ? { ...plain, gradual: true } : plain
    }),
  }
  const shown = gridStretches(finalGrid, bpm, timeSignature).filter((st) => st.fromBar >= startBar && st.fromBar < endBar)
  return {
    kind: 'grid',
    grid: finalGrid,
    startBar,
    endBar,
    startBpm: shown[0]?.startBpm ?? bpm,
    endBpm: shown[shown.length - 1]?.endBpm ?? bpm,
    pointCount: split.knots.length,
    curve: curve.map((c) => ({ timeMs: c.timeMs + offset, bpm: c.bpm })),
  }
}
