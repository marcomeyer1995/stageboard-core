import { useClockSyncStore } from '../store/useClockSyncStore'
import { clockSyncLog } from './clockSyncDebug'
import { getStageServerUrl } from './stageServer'

interface ClockSample {
  rtt: number
  offset: number
}

/** A sample with when it was taken (local Date.now(), midpoint of its round trip). */
interface TimedSample extends ClockSample {
  at: number
}

const BURST_SAMPLE_COUNT = 7

/** Below this many samples, a linear fit has no real predictive power (2 points always fit a
 * line perfectly, with an R² that means nothing) - falls back to plain min-RTT selection. */
const MIN_SAMPLES_FOR_ASYMMETRY_FIT = 3
/** Below this RTT spread within a burst, there's not enough dynamic range to extrapolate an
 * intercept from - on a tight, low-jitter path (the common case - a wired laptop, or WiFi
 * close to the AP), any offset/RTT "trend" in a few-ms-wide burst is just noise, and fitting a
 * line through it would amplify that noise rather than correct anything. Below this threshold,
 * falls back to plain min-RTT selection, which is already accurate on a tight path. */
const MIN_RTT_SPREAD_FOR_ASYMMETRY_FIT_MS = 10
/** Below this R², the offset/RTT relationship in this burst isn't a real trend - don't
 * extrapolate a line through noise. Confirmed live (#31 second follow-up): a genuinely
 * asymmetric WiFi path fit at R² > 0.99 across two independent bursts a minute apart (slope
 * ~0.50, intercept within 2ms of each other) - 0.5 is a deliberately generous floor, well
 * below what a real asymmetry signal produces, while still excluding a burst that's just
 * scattered noise. */
const MIN_R_SQUARED_FOR_ASYMMETRY_FIT = 0.5

/** How many recent bursts' winning offsets to keep for the drift reading below - see
 * `driftMs`'s doc comment in useClockSyncStore.ts. 5 syncs at the 60s resync interval is a
 * 5-minute trailing window: long enough to smooth out one noisy burst, short enough to still
 * flag a real problem (a Stage-Server clock jump, a device actually drifting) within a few
 * minutes rather than papering over it forever. */
const OFFSET_HISTORY_SIZE = 5

/** The last few bursts' winning offsets, oldest first - module-level rather than in the
 * zustand store since it's pure internal bookkeeping for computing `driftMs`, nothing else
 * ever reads it (same pattern as e.g. useWorkspaceStore.ts's `nameChangesHandle`). */
let offsetHistory: number[] = []

/*
 * Continuous sync (docs/29 §5.6, step 4 of #690). One burst a minute, its fastest sample applied
 * at once, moved a tablet's band time by 12-15 ms twice in two minutes on the band's WLAN (Gig
 * measurement 2026-11-04), while an estimate over the same minutes from many samples stayed within
 * 2 ms. Now: one sample every SAMPLE_INTERVAL_MS, an estimate over the last WINDOW_MS from the
 * fastest quarter of them - a line over time, because a tablet's clock runs 10-60 ppm against the
 * server's (up to 3.6 ms a minute) - and the offset in use follows that estimate at SLEW_MS_PER_S
 * at most instead of jumping. The first burst still locks on at once.
 */
export const SAMPLE_INTERVAL_MS = 2_000
const WINDOW_MS = 120_000
const BEST_FRACTION = 0.25
const MIN_BEST = 5
/** Before this many samples over this long, the window doesn't decide yet (the burst does). */
const MIN_WINDOW_SAMPLES = 10
const MIN_WINDOW_SPAN_MS = 20_000
/** A drift line needs this much time between the samples it uses. */
const MIN_SLOPE_SPAN_MS = 30_000
/** The offset in use moves towards the estimate by at most this - 0.2 %, so band time never jumps. */
const SLEW_MS_PER_S = 2
/** Further away than this the estimate is taken at once (first lock, a Stage-Server clock change). */
const JUMP_MS = 50

let window_: TimedSample[] = []
/** The offset in use: `target` (a line over local time) plus an error that shrinks at SLEW_MS_PER_S. */
let applied: { target: { at: number; offsetMs: number; perMs: number }; errorMs: number; since: number } | null = null

function targetAt(t: number): number {
  return applied ? applied.target.offsetMs + applied.target.perMs * (t - applied.target.at) : 0
}

function appliedAt(t: number): number {
  if (!applied) return 0
  const left = Math.max(0, Math.abs(applied.errorMs) - (SLEW_MS_PER_S * (t - applied.since)) / 1000)
  return targetAt(t) + Math.sign(applied.errorMs) * left
}

function aim(now: number, offsetMs: number, perMs: number): void {
  const current = applied ? appliedAt(now) : null
  const error = current === null ? 0 : current - offsetMs
  applied = { target: { at: now, offsetMs, perMs }, errorMs: Math.abs(error) > JUMP_MS ? 0 : error, since: now }
}

/** The window's estimate at `now` - null while it doesn't hold enough yet. Exported for tests. */
export function estimateFromWindow(samples: readonly TimedSample[], now: number): { offsetMs: number; perMs: number; uncertaintyMs: number; rttMs: number } | null {
  const recent = samples.filter((s) => s.at >= now - WINDOW_MS)
  if (recent.length < MIN_WINDOW_SAMPLES || now - Math.min(...recent.map((s) => s.at)) < MIN_WINDOW_SPAN_MS) return null
  const best = [...recent].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(MIN_BEST, Math.ceil(recent.length * BEST_FRACTION)))
  const span = Math.max(...best.map((s) => s.at)) - Math.min(...best.map((s) => s.at))
  let offsetMs: number
  let perMs = 0
  let residuals: number[]
  if (best.length >= 8 && span >= MIN_SLOPE_SPAN_MS) {
    const fit = fitLine(best.map((s) => ({ x: s.at - now, y: s.offset })))
    offsetMs = fit.intercept
    perMs = fit.slope
    residuals = best.map((s) => Math.abs(s.offset - (fit.intercept + fit.slope * (s.at - now))))
  } else {
    const sorted = best.map((s) => s.offset).sort((a, b) => a - b)
    offsetMs = sorted[Math.floor(sorted.length / 2)]!
    residuals = best.map((s) => Math.abs(s.offset - offsetMs))
  }
  residuals.sort((a, b) => a - b)
  return { offsetMs, perMs, uncertaintyMs: residuals[Math.floor(residuals.length / 2)]!, rttMs: best[0]!.rtt }
}

/**
 * One GET /time round trip. The server timestamps its response at essentially the same
 * instant it receives the request (no processing in between), so it's treated as having been
 * taken at the midpoint of the client's round trip - the standard NTP offset estimate for a
 * single sample.
 */
async function takeSample(base: string): Promise<ClockSample | null> {
  const t0 = Date.now()
  try {
    const response = await fetch(`${base}/time`)
    if (!response.ok) return null
    const { serverTime } = (await response.json()) as { serverTime: number }
    const t1 = Date.now()
    const sample = { rtt: t1 - t0, offset: serverTime - (t0 + t1) / 2 }
    clockSyncLog('sample', sample)
    window_.push({ ...sample, at: (t0 + t1) / 2 })
    while (window_.length > 0 && window_[0]!.at < t1 - WINDOW_MS) window_.shift()
    return sample
  } catch {
    return null
  }
}

interface LinearFit {
  slope: number
  intercept: number
  rSquared: number
}

/** Ordinary least-squares fit of y over x. Pure/generic on purpose - trivial to unit-test in
 * isolation from the network-sampling code around it. */
function fitLine(points: { x: number; y: number }[]): LinearFit {
  const n = points.length
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n
  const covariance = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0)
  const varianceX = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0)
  const slope = varianceX === 0 ? 0 : covariance / varianceX
  const intercept = meanY - slope * meanX

  const ssTot = points.reduce((sum, p) => sum + (p.y - meanY) ** 2, 0)
  const ssRes = points.reduce((sum, p) => sum + (p.y - (intercept + slope * p.x)) ** 2, 0)
  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot

  return { slope, intercept, rSquared }
}

/**
 * Estimates one burst's offset. The baseline is the lowest-RTT sample's own offset - the
 * sample least distorted by network jitter, the selection real NTP clients use, and already a
 * robust estimate on a *symmetric* path (confirmed live on real devices, #31 follow-up: even
 * when a burst's RTTs swing wildly - a rare single sample spiking to 300-450ms is not unusual
 * on WiFi without a dedicated stage AP - the lowest-RTT sample's offset stayed within a few ms
 * of the previous sync's).
 *
 * What that baseline can't fix is a *systematically asymmetric* path - one direction
 * consistently slower than the other (WiFi radio behavior, not congestion), rather than
 * random per-packet jitter. NTP's midpoint math bakes in a symmetry assumption: the error term
 * is `(outbound_delay - inbound_delay) / 2`, which scales linearly with RTT when the asymmetry
 * is a roughly constant *ratio* of the delay rather than a fixed noise floor. Confirmed live
 * (#31 second follow-up) on a tablet whose burst offsets correlated near-perfectly with RTT
 * (R² > 0.99, slope ~0.50, i.e. essentially the entire round trip sat in one direction) across
 * two independent bursts a minute apart - even that burst's fastest sample still carried
 * roughly half of its own RTT as bias. Extrapolating a line through the burst's own
 * (RTT, offset) pairs to RTT=0 cancels that term directly, without needing to know which
 * direction is slow or by how much.
 *
 * Only trusted when there's real evidence of a linear trend (see the three
 * MIN_*_FOR_ASYMMETRY_FIT constants above) - on a tight, already-symmetric burst, fitting a
 * line through a few ms of pure noise would amplify it rather than correct anything, so this
 * falls back to the min-RTT baseline whenever the fit isn't clearly a genuine trend.
 */
function estimateOffset(samples: ClockSample[]): { offsetMs: number; usedAsymmetryFit: boolean } {
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a))

  if (samples.length < MIN_SAMPLES_FOR_ASYMMETRY_FIT) return { offsetMs: best.offset, usedAsymmetryFit: false }

  const rtts = samples.map((s) => s.rtt)
  const spread = Math.max(...rtts) - Math.min(...rtts)
  if (spread < MIN_RTT_SPREAD_FOR_ASYMMETRY_FIT_MS) return { offsetMs: best.offset, usedAsymmetryFit: false }

  const fit = fitLine(samples.map((s) => ({ x: s.rtt, y: s.offset })))
  if (fit.rSquared < MIN_R_SQUARED_FOR_ASYMMETRY_FIT) return { offsetMs: best.offset, usedAsymmetryFit: false }

  return { offsetMs: fit.intercept, usedAsymmetryFit: true }
}

/**
 * Runs a burst of round trips (docs/00 §4's "Burst Handshake") and estimates this device's
 * offset from it - see `estimateOffset` above for the min-RTT-baseline-vs-asymmetry-fit logic.
 *
 * What is NOT trustworthy on its own is `jitterMs` (the spread between a single burst's
 * fastest and slowest RTT) as a signal of whether the *offset* can be trusted - that spread is
 * dominated by rare single-sample spikes that `estimateOffset` already accounts for. So this
 * also maintains `offsetHistory`, a short trailing window of recent bursts' offsets, and
 * derives `driftMs` (the spread within that window) - a cross-burst stability reading that's
 * what SystemHealthWidget.tsx's status color actually keys off now, not `jitterMs`. `jitterMs`
 * is still recorded (useClockSyncStore.ts) as a raw per-burst diagnostic, just no longer the
 * trust signal.
 *
 * Writes the result to useClockSyncStore for any widget to read; getServerTime() below reads
 * the same store. Never throws: no configured Stage-Server, or one that's entirely
 * unreachable, just leaves the previous sync in the store untouched, so a caller can always
 * retry later without special-casing failure.
 */
export async function syncClock(sampleCount = BURST_SAMPLE_COUNT): Promise<number> {
  const base = getStageServerUrl()
  if (!base) return useClockSyncStore.getState().offsetMs

  const samples: ClockSample[] = []
  for (let i = 0; i < sampleCount; i++) {
    const sample = await takeSample(base)
    if (sample) samples.push(sample)
  }
  if (samples.length === 0) return useClockSyncStore.getState().offsetMs

  const fastestRtt = Math.min(...samples.map((s) => s.rtt))
  const rtts = samples.map((s) => s.rtt)
  const jitterMs = Math.max(...rtts) - Math.min(...rtts)
  const { offsetMs, usedAsymmetryFit } = estimateOffset(samples)

  offsetHistory.push(offsetMs)
  if (offsetHistory.length > OFFSET_HISTORY_SIZE) offsetHistory.shift()
  const driftMs = offsetHistory.length >= 2 ? Math.max(...offsetHistory) - Math.min(...offsetHistory) : null

  clockSyncLog('burst done', { samples, offsetMs, usedAsymmetryFit, jitterMs, driftMs, offsetHistory: [...offsetHistory] })
  // The burst locks on until the window holds enough samples; after that the window decides.
  const now = Date.now()
  if (!estimateFromWindow(window_, now)) aim(now, offsetMs, 0)
  useClockSyncStore.getState().setSync({ offsetMs: appliedAt(now), rttMs: fastestRtt, jitterMs, driftMs })
  return offsetMs
}

/** One continuous sample (every SAMPLE_INTERVAL_MS, useClockSync.ts): adds it to the window and
 * aims the offset in use at the window's estimate. Never throws. */
export async function sampleClock(): Promise<void> {
  const base = getStageServerUrl()
  if (!base) return
  const sample = await takeSample(base)
  if (!sample) return
  const now = Date.now()
  const estimate = estimateFromWindow(window_, now)
  if (!estimate) return
  aim(now, estimate.offsetMs, estimate.perMs)
  offsetHistory.push(estimate.offsetMs)
  if (offsetHistory.length > OFFSET_HISTORY_SIZE * 30) offsetHistory.shift()
  const driftMs = offsetHistory.length >= 2 ? Math.max(...offsetHistory) - Math.min(...offsetHistory) : null
  useClockSyncStore.getState().setSync({ offsetMs: appliedAt(now), rttMs: estimate.rttMs, jitterMs: estimate.uncertaintyMs, driftMs })
}

/**
 * The synchronized master-clock time (docs/00 §4) - local time corrected by the last
 * syncClock() call's offset. Falls back to plain local time before the first sync, or when
 * the Stage-Server has never been reachable, rather than throwing.
 */
export function getServerTime(): number {
  const now = Date.now()
  return now + (applied ? appliedAt(now) : useClockSyncStore.getState().offsetMs)
}

if (typeof window !== 'undefined') (window as unknown as { __sbClockSync: unknown }).__sbClockSync = { appliedAt: () => appliedAt(Date.now()), estimate: () => estimateFromWindow(window_, Date.now()), samples: () => window_.length }

/** Test-only reset - production code never needs to clear the sync state explicitly. */
export function __resetClockSyncForTests(): void {
  offsetHistory = []
  window_ = []
  applied = null
  useClockSyncStore.getState().reset()
}
