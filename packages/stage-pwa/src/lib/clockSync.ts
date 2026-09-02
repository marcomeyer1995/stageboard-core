import { useClockSyncStore } from '../store/useClockSyncStore'
import { getStageServerUrl } from './stageServer'

interface ClockSample {
  rtt: number
  offset: number
}

const BURST_SAMPLE_COUNT = 7

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
    return { rtt: t1 - t0, offset: serverTime - (t0 + t1) / 2 }
  } catch {
    return null
  }
}

/**
 * Runs a burst of round trips (docs/00 §4's "Burst Handshake") and keeps the lowest-RTT
 * sample's offset - the sample least distorted by network jitter, exactly the selection real
 * NTP clients use. Also derives a jitter reading (the spread between the burst's fastest and
 * slowest RTT) so a caller can tell a clean sync from a noisy one, not just get a number.
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

  useClockSyncStore.getState().setSync({ offsetMs: best.offset, rttMs: best.rtt, jitterMs })
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
  useClockSyncStore.getState().reset()
}
