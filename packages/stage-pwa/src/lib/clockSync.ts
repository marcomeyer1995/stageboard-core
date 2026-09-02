import { useClockSyncStore } from '../store/useClockSyncStore'
import { clockSyncLog } from './clockSyncDebug'
import { getStageServerUrl } from './stageServer'

interface ClockSample {
  rtt: number
  offset: number
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
  useClockSyncStore.getState().setSync({ offsetMs, rttMs: fastestRtt, jitterMs, driftMs })
  return offsetMs
}

/**
 * The synchronized master-clock time (docs/00 §4) - local time corrected by the last
 * syncClock() call's offset. Falls back to plain local time before the first sync, or when
 * the Stage-Server has never been reachable, rather than throwing.
 */
export function getServerTime(): number {
  return Date.now() + useClockSyncStore.getState().offsetMs
}

/** Test-only reset - production code never needs to clear the sync state explicitly. */
export function __resetClockSyncForTests(): void {
  offsetHistory = []
  useClockSyncStore.getState().reset()
}
