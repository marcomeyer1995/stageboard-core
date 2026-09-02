import { useClockSyncStore } from '../store/useClockSyncStore'
import { clockSyncLog } from './clockSyncDebug'
import { getStageServerUrl } from './stageServer'

interface ClockSample {
  rtt: number
  offset: number
}

const BURST_SAMPLE_COUNT = 7

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

/**
 * Runs a burst of round trips (docs/00 §4's "Burst Handshake") and keeps the lowest-RTT
 * sample's offset - the sample least distorted by network jitter, exactly the selection real
 * NTP clients use. Confirmed live against real devices on a noisy home WiFi network (#31
 * follow-up): even when a burst's RTTs swing wildly (a rare single sample spiking to 300-450ms
 * is not unusual on WiFi without a dedicated stage AP), the lowest-RTT sample's offset stayed
 * within a few ms of the previous sync's - this selection is already a robust per-burst
 * estimate on its own.
 *
 * What is NOT trustworthy on its own is `jitterMs` (the spread between a single burst's
 * fastest and slowest RTT) as a signal of whether the *offset* can be trusted - that spread is
 * dominated by exactly those rare single-sample spikes, which the min-RTT selection above
 * already filters out. So this also maintains `offsetHistory`, a short trailing window of
 * recent bursts' winning offsets, and derives `driftMs` (the spread within that window) - a
 * cross-burst stability reading that's what SystemHealthWidget.tsx's status color actually
 * keys off now, not `jitterMs`. `jitterMs` is still recorded (useClockSyncStore.ts) as a raw
 * per-burst diagnostic, just no longer the trust signal.
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

  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a))
  const rtts = samples.map((s) => s.rtt)
  const jitterMs = Math.max(...rtts) - Math.min(...rtts)

  offsetHistory.push(best.offset)
  if (offsetHistory.length > OFFSET_HISTORY_SIZE) offsetHistory.shift()
  const driftMs = offsetHistory.length >= 2 ? Math.max(...offsetHistory) - Math.min(...offsetHistory) : null

  clockSyncLog('burst done', { samples, best, jitterMs, driftMs, offsetHistory: [...offsetHistory] })
  useClockSyncStore.getState().setSync({ offsetMs: best.offset, rttMs: best.rtt, jitterMs, driftMs })
  return best.offset
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
