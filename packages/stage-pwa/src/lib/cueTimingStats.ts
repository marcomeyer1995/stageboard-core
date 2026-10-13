/**
 * How punctually the cue scheduler worked on this device (#477, docs/21 §5) - the numbers that set
 * CUE_LOOKAHEAD_MS. A cue is late only when the scheduler's 25 ms timer is held up longer than the
 * look-ahead minus one tick, i.e. by a main-thread stall; so this records how late every tick came
 * while a song played, every cue handed over after its send moment, and - independent of cues -
 * every main-thread stall while a song played (`useStallMonitor`). Shown in the Diagnose tab,
 * readable over USB as `window.__sbCueScheduler`.
 */

/** Upper edges (ms) of the tick-gap buckets; one more bucket collects everything above the last. */
export const TICK_GAP_BUCKETS_MS = [30, 50, 75, 100, 150, 250] as const
/** Upper edges (ms) of the stall buckets (a long task is ≥ 50 ms by definition). */
export const STALL_BUCKETS_MS = [75, 100, 125, 150, 200, 300] as const

export interface CueTimingStats {
  since: number
  ticks: number
  /** Count per bucket of TICK_GAP_BUCKETS_MS, plus a last one for longer gaps. */
  tickGapBuckets: number[]
  tickGapMaxMs: number
  cuesHandedOver: number
  /** Handed over after their send moment had already passed - they went out late. */
  lateHandovers: number
  lateMaxMs: number
  /** Main-thread stalls of 50 ms and more while a song played (`useStallMonitor`), whether or not
   * the song has cues - per bucket of STALL_BUCKETS_MS plus one above. */
  stallBuckets: number[]
  stallMaxMs: number
  /** How long songs were playing while stalls were watched, to read the counts as a rate. */
  watchedMs: number
}

function fresh(): CueTimingStats {
  return { since: Date.now(), ticks: 0, tickGapBuckets: TICK_GAP_BUCKETS_MS.map(() => 0).concat(0), tickGapMaxMs: 0, cuesHandedOver: 0, lateHandovers: 0, lateMaxMs: 0, stallBuckets: STALL_BUCKETS_MS.map(() => 0).concat(0), stallMaxMs: 0, watchedMs: 0 }
}

let stats = fresh()
function expose(): void {
  if (typeof window !== 'undefined') (window as unknown as { __sbCueScheduler: CueTimingStats }).__sbCueScheduler = stats
}
expose()

export function getCueTimingStats(): CueTimingStats {
  return stats
}

export function resetCueTimingStats(): void {
  stats = fresh()
  expose()
}

/** One scheduler tick, `gapMs` after the previous one of the same run. */
export function recordTick(gapMs: number): void {
  stats.ticks++
  const bucket = TICK_GAP_BUCKETS_MS.findIndex((edge) => gapMs <= edge)
  stats.tickGapBuckets[bucket === -1 ? TICK_GAP_BUCKETS_MS.length : bucket]++
  stats.tickGapMaxMs = Math.max(stats.tickGapMaxMs, gapMs)
}

/** One cue handed over, `lateMs` after its send moment (≤ 0: in time). */
export function recordHandover(lateMs: number): void {
  stats.cuesHandedOver++
  if (lateMs > 0) {
    stats.lateHandovers++
    stats.lateMaxMs = Math.max(stats.lateMaxMs, lateMs)
  }
}

/** One main-thread stall (a long task) while a song played. */
export function recordStall(durationMs: number): void {
  const bucket = STALL_BUCKETS_MS.findIndex((edge) => durationMs <= edge)
  stats.stallBuckets[bucket === -1 ? STALL_BUCKETS_MS.length : bucket]++
  stats.stallMaxMs = Math.max(stats.stallMaxMs, durationMs)
}

/** Playing time during which stalls were watched. */
export function recordWatched(ms: number): void {
  stats.watchedMs += ms
}
