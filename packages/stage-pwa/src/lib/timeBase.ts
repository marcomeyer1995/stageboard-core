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
/** A pair this far off the line: the clock lost time (suspended, resumed) - start over. */
const RESTART_MS = 250
/** Without a new pair for this long, the line is stale. */
const STALE_MS = 1_000
/** The buffer gap is the upper edge of `currentTime` − heard over this window (`currentTime`
 * lags in steps, so its upper edge is the truth). */
const GAP_WINDOW_MS = 10_000
const GAP_MIN_SPAN_MS = 5_000
/** It changes only when the edge stayed this far away for this long. */
const GAP_HOLD_MS = 30
const GAP_CONFIRM_MS = 10_000

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
  private gapCandidateSince: number | null = null

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
    if (this.line && Math.abs(pair.ctxMs - at(this.line, pair.perfMs)) > RESTART_MS) this.restart(ctx)
    this.pairs.push(pair)
    this.lastPairAt = now
    while (this.pairs.length > 0 && this.pairs[0]!.perfMs < now - WINDOW_MS) this.pairs.shift()
    if (now - this.lastRefit >= REFIT_MS) this.refit(now)
    if (this.line) this.sampleGap(ctx, now)
  }

  /** The audio clock now, in `currentTime`'s sense (s) - null while not ready. */
  now(ctx: AudioContext): number | null {
    const now = this.perfNow()
    if (ctx !== this.context || !this.line || this.gapMs === null || now - this.lastPairAt > STALE_MS) return null
    return (at(this.line, now) + this.gapMs) / 1000
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
    this.gapCandidateSince = null
  }

  private refit(now: number): void {
    this.lastRefit = now
    if (this.pairs.length < MIN_PAIRS || this.pairs[this.pairs.length - 1]!.perfMs - this.pairs[0]!.perfMs < MIN_SPAN_MS) return
    const fitted = robustLine(this.pairs)
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

  private sampleGap(ctx: AudioContext, now: number): void {
    this.gaps.push({ perfMs: now, gapMs: ctx.currentTime * 1000 - at(this.line!, now) })
    while (this.gaps.length > 0 && this.gaps[0]!.perfMs < now - GAP_WINDOW_MS) this.gaps.shift()
    if (now - this.gaps[0]!.perfMs < GAP_MIN_SPAN_MS) return
    const edge = Math.max(...this.gaps.map((g) => g.gapMs))
    if (this.gapMs === null) {
      this.gapMs = edge
      return
    }
    if (Math.abs(edge - this.gapMs) <= GAP_HOLD_MS) {
      this.gapCandidateSince = null
      return
    }
    this.gapCandidateSince ??= now
    if (now - this.gapCandidateSince >= GAP_CONFIRM_MS) {
      this.gapMs = edge
      this.gapCandidateSince = null
    }
  }
}

/** The one time service of this device (the shared AudioContext's). */
export const timeBase = new TimeBase()
if (typeof window !== 'undefined') (window as unknown as { __sbTimeBase: TimeBase }).__sbTimeBase = timeBase
