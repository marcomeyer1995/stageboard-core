/**
 * The device's time service, step 1 of docs/29 (§5.2, #690): where the audio clock is, measured
 * instead of guessed. `AudioContext.getOutputTimestamp()` pairs the audio time being heard right
 * now with its `performance.now()` - the hardware's own answer, ±0.3-0.4 ms on the Fire and the
 * Redmi, where `currentTime` jumps in 64-192 ms steps on the Fire (±28 ms, docs/29 §10). A robust
 * line through the last 20 s of pairs gives the audio time at any `performance.now()`: no steps,
 * and the audio clock's own rate (Fire ~+260 ppm) is in its slope.
 *
 * Engines keep asking for "the audio clock now" in `currentTime`'s sense (what is being rendered),
 * so their stored latencies stay valid until step 3 measures the remainder per output: that is the
 * heard time plus the buffer between rendering and hearing (Fire ~364 ms, Redmi ~36 ms) - a
 * constant per device, estimated once and only changed when it moved for good.
 *
 * Read only through `sharedAudioClock` (audioClock.ts), which falls back to its smoother while this
 * isn't ready (a context just started, not running, or a browser without output timestamps).
 */

/** The pairs the line is fitted through. Long, because the Fire gives only ~16 a second, with a
 * sawtooth of a few ms and now and then a 68 ms outlier. */
const WINDOW_MS = 20_000
/** Before this much span, the slope means nothing yet. */
const MIN_SPAN_MS = 2_000
const MIN_PAIRS = 20
const REFIT_MS = 500
/** A new line that moves "now" by more than this is taken only once it was seen this often in a
 * row - one bad window must not move every output at once. */
const CONFIRM_JUMP_MS = 3
const CONFIRMATIONS = 3
/** The Fire's output timestamps read *early* now and then - for 0.1-13 s, ~17-32 ms, often
 * creeping in and drifting ~1500 ppm, then snapping back; one or two pairs up to 251 ms at a Stop
 * (sync-bench Gig, 2026-11-04) - never late. A fit through the middle of the pairs followed them:
 * the click bent by up to 35 ms; gating pairs by their distance from the line let a glitch that
 * creeps in under the gate tilt it to -1300 ppm, 68 ms off. So the line runs along the upper edge
 * of the window's pairs, this percentile: early pairs don't move it until they fill nearly the
 * whole window. A constant offset of the line doesn't matter - the buffer gap is measured
 * against the same line and takes it out (`now`). */
const EDGE_PERCENTILE = 0.9
/** The audio clock's rate against performance.now() is steady to a few ppm: once the window is
 * this full, a refit changes the line's rate by at most MAX_RATE_STEP (1 ppm a second). */
const STEADY_SPAN_MS = 15_000
const MAX_RATE_STEP = 0.5e-6
/** The gap is measured, and the rate fitted, only from pairs this close to the line (or 4 × the
 * residual) - not inside a glitch. */
const GATE_MS = 3
/** Pairs this far off the line for this long: the clock lost time (suspended, resumed) - start
 * over. A single one is not enough: at a Stop the Fire gives one or two pairs up to 251 ms off,
 * and starting over on one left the click on the fallback clock for 20 s and moved it by 5 ms
 * (sync-bench Gig, 2026-11-04). */
const RESTART_MS = 250
const RESTART_CONFIRM_MS = 500
const RESTART_CONFIRM_PAIRS = 3
/** Without a new pair for this long, the line is stale. */
const STALE_MS = 1_000
/** The buffer gap is the upper edge of `currentTime` − heard over this window (`currentTime`
 * lags in steps, so its upper edge is the truth). */
const GAP_WINDOW_MS = 30_000
/** On the Fire (64-192 ms steps) 5 s were too short for the edge: the gap came out ~30 ms low and
 * was corrected a minute later in one go (sync-bench, 2026-11-04) - ready only after this long. */
const GAP_MIN_SPAN_MS = 20_000
/** The edge is this percentile, not the maximum: now and then `currentTime` reads ahead of the real
 * clock (Fire up to +58 ms) - a maximum took that and set the gap ~33 ms too high (sync-bench).
 * The 98th: lower ones sit below the edge by their share of a step (90th: ~6 ms at 64 ms). */
const GAP_PERCENTILE = 0.98
/** The gap moves towards the edge at most this much per reading - 0.05 ms every 50 ms, 1 ms a
 * second, up or down - so all outputs move together and never jump. */
const GAP_STEP_PER_SAMPLE_MS = 0.05
/** The percentile itself wobbles by a few ms; following that all the time made the click wobble
 * by ~1 ms (sync-bench, Fire). The gap moves only once it is this far off, then until it is within
 * GAP_SETTLED_MS, and stays put again. */
const GAP_DEADBAND_MS = 3
const GAP_SETTLED_MS = 0.5

interface Pair {
  perfMs: number
  ctxMs: number
}
interface Line {
  a: number
  b: number
}

export interface TimeBaseQuality {
  pairs: number
  /** Median distance of the pairs from the line. */
  residualMs: number | null
  /** The audio clock's rate against `performance.now()`. */
  ppm: number | null
  gapMs: number | null
  ready: boolean
}

const at = (line: Line, perfMs: number) => line.a + line.b * perfMs

function robustLine(pairs: readonly Pair[]): { line: Line; residualMs: number } | null {
  let use = pairs
  let line: Line | null = null
  let residualMs = 0
  for (let pass = 0; pass < 3; pass++) {
    const n = use.length
    if (n < MIN_PAIRS) return null
    let mx = 0
    let my = 0
    for (const p of use) {
      mx += p.perfMs
      my += p.ctxMs
    }
    mx /= n
    my /= n
    let sxx = 0
    let sxy = 0
    for (const p of use) {
      sxx += (p.perfMs - mx) ** 2
      sxy += (p.perfMs - mx) * (p.ctxMs - my)
    }
    if (sxx === 0) return null
    const b = sxy / sxx
    line = { a: my - b * mx, b }
    const fitted = line
    const res = use.map((p) => Math.abs(p.ctxMs - at(fitted, p.perfMs)))
    const sorted = [...res].sort((x, y) => x - y)
    residualMs = sorted[Math.floor(sorted.length / 2)]!
    const limit = Math.max(3, 4 * residualMs)
    use = use.filter((_, i) => res[i]! <= limit)
  }
  return line ? { line, residualMs } : null
}

/** The line through the window: its rate from a robust fit through `ratePairs` (limited to
 * MAX_RATE_STEP from `rate` once steady), its place the EDGE_PERCENTILE of all pairs at that rate. */
function edgeLine(pairs: readonly Pair[], ratePairs: readonly Pair[], rate: number | null): { line: Line; residualMs: number } | null {
  const free = robustLine(ratePairs)
  if (!free) return null
  const b = rate === null ? free.line.b : rate + Math.max(-MAX_RATE_STEP, Math.min(MAX_RATE_STEP, free.line.b - rate))
  const offsets = pairs.map((p) => p.ctxMs - b * p.perfMs).sort((x, y) => x - y)
  return { line: { a: offsets[Math.floor(EDGE_PERCENTILE * (offsets.length - 1))]!, b }, residualMs: free.residualMs }
}

export class TimeBase {
  private context: AudioContext | null = null
  private pairs: Pair[] = []
  private line: Line | null = null
  private residualMs: number | null = null
  private pending: { line: Line; count: number } | null = null
  private lastRefit = -Infinity
  private lastPairAt = -Infinity
  private gaps: { perfMs: number; gapMs: number }[] = []
  private gapMs: number | null = null
  private gapMoving = false
  private farSince: number | null = null
  private farPairs = 0

  constructor(private readonly perfNow: () => number = () => performance.now()) {}

  /** Takes one reading - called every ~50 ms while the context runs (audioClock.ts). */
  sample(ctx: AudioContext): void {
    if (ctx !== this.context) this.restart(ctx)
    if (ctx.state !== 'running' || typeof ctx.getOutputTimestamp !== 'function') return
    const ts = ctx.getOutputTimestamp()
    const now = this.perfNow()
    if (!ts.contextTime || !ts.performanceTime) return
    const pair = { perfMs: ts.performanceTime, ctxMs: ts.contextTime * 1000 }
    const last = this.pairs[this.pairs.length - 1]
    if (last && last.perfMs === pair.perfMs) return
    if (this.line && Math.abs(pair.ctxMs - at(this.line, pair.perfMs)) > RESTART_MS) {
      this.farSince ??= now
      this.farPairs++
      if (now - this.farSince < RESTART_CONFIRM_MS || this.farPairs < RESTART_CONFIRM_PAIRS) return
      this.restart(ctx)
    } else {
      this.farSince = null
      this.farPairs = 0
    }
    this.pairs.push(pair)
    this.lastPairAt = now
    while (this.pairs.length > 0 && this.pairs[0]!.perfMs < now - WINDOW_MS) this.pairs.shift()
    if (now - this.lastRefit >= REFIT_MS) this.refit(now)
    // While the newest pair is off the line - a glitch, or a move not yet confirmed - the gap would
    // measure the line's error, not the buffer.
    if (this.line && Math.abs(pair.ctxMs - at(this.line, pair.perfMs)) <= this.gate()) this.sampleGap(ctx, now)
  }

  /** The audio clock now, in `currentTime`'s sense (s) - null while not ready. */
  now(ctx: AudioContext): number | null {
    const now = this.perfNow()
    if (ctx !== this.context || !this.line || this.gapMs === null || now - this.lastPairAt > STALE_MS) return null
    return (at(this.line, now) + this.gapMs) / 1000
  }

  /** Whether `now` reads the output timestamps (precise) rather than nothing (the caller falls back). */
  ready(ctx: AudioContext): boolean {
    return this.now(ctx) !== null
  }

  /** Audio seconds per wall-clock second (the line's slope) - 1 while not ready. The song clock runs
   * on the wall clock, so audio that should follow it plays at the inverse (docs/29 §5.5). */
  audioPerWall(ctx: AudioContext): number {
    return ctx === this.context && this.line ? this.line.b : 1
  }

  quality(): TimeBaseQuality {
    return {
      pairs: this.pairs.length,
      residualMs: this.residualMs,
      ppm: this.line ? (this.line.b - 1) * 1e6 : null,
      gapMs: this.gapMs,
      ready: this.line !== null && this.gapMs !== null,
    }
  }

  private restart(ctx: AudioContext): void {
    this.context = ctx
    this.pairs = []
    this.line = null
    this.residualMs = null
    this.pending = null
    this.gaps = []
    this.gapMs = null
    this.gapMoving = false
    this.farSince = null
    this.farPairs = 0
  }

  private refit(now: number): void {
    this.lastRefit = now
    if (this.pairs.length < MIN_PAIRS || this.pairs[this.pairs.length - 1]!.perfMs - this.pairs[0]!.perfMs < MIN_SPAN_MS) return
    const steady = this.line !== null && this.pairs[this.pairs.length - 1]!.perfMs - this.pairs[0]!.perfMs >= STEADY_SPAN_MS
    // The rate from the pairs near the line only (not a glitch); too few of them - keep the rate.
    const line = this.line
    const near = line ? this.pairs.filter((p) => Math.abs(p.ctxMs - at(line, p.perfMs)) <= this.gate()) : this.pairs
    const enough = near.length >= MIN_PAIRS && near[near.length - 1]!.perfMs - near[0]!.perfMs >= STEADY_SPAN_MS / 2
    const fitted = edgeLine(this.pairs, enough ? near : this.pairs, steady ? line!.b : null)
    if (!fitted) return
    this.residualMs = fitted.residualMs
    if (!this.line || Math.abs(at(fitted.line, now) - at(this.line, now)) <= CONFIRM_JUMP_MS) {
      this.line = fitted.line
      this.pending = null
      return
    }
    if (this.pending && Math.abs(at(fitted.line, now) - at(this.pending.line, now)) <= CONFIRM_JUMP_MS) this.pending = { line: fitted.line, count: this.pending.count + 1 }
    else this.pending = { line: fitted.line, count: 1 }
    if (this.pending.count >= CONFIRMATIONS) {
      this.line = this.pending.line
      this.pending = null
    }
  }

  private gate(): number {
    return Math.max(GATE_MS, 4 * (this.residualMs ?? 0))
  }

  private sampleGap(ctx: AudioContext, now: number): void {
    this.gaps.push({ perfMs: now, gapMs: ctx.currentTime * 1000 - at(this.line!, now) })
    while (this.gaps.length > 0 && this.gaps[0]!.perfMs < now - GAP_WINDOW_MS) this.gaps.shift()
    if (now - this.gaps[0]!.perfMs < GAP_MIN_SPAN_MS) return
    const sorted = this.gaps.map((g) => g.gapMs).sort((a, b) => a - b)
    const edge = sorted[Math.floor(GAP_PERCENTILE * (sorted.length - 1))]!
    if (this.gapMs === null) {
      this.gapMs = edge
      return
    }
    const off = edge - this.gapMs
    if (Math.abs(off) > GAP_DEADBAND_MS) this.gapMoving = true
    else if (Math.abs(off) < GAP_SETTLED_MS) this.gapMoving = false
    if (this.gapMoving) this.gapMs += Math.max(-GAP_STEP_PER_SAMPLE_MS, Math.min(GAP_STEP_PER_SAMPLE_MS, off))
  }
}

/** The one time service of this device (the shared AudioContext's). */
export const timeBase = new TimeBase()
if (typeof window !== 'undefined') (window as unknown as { __sbTimeBase: TimeBase }).__sbTimeBase = timeBase
