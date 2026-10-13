import type { CalibrationMatch } from 'shared-types'

export type LatencyMatch = CalibrationMatch

/**
 * The delay at which the detected onsets line up with the planned click times (all in ms of server
 * time) - a search over every candidate delay between `minMs` and `maxMs`, scoring how many planned
 * clicks have an onset within `toleranceMs`. Matching the whole irregular pattern (schedule.ts)
 * rather than each click to its nearest planned time is what makes a delay longer than the gaps
 * come out right instead of folding back (Marco, 2026-10-13). Null when nothing matches at all.
 */
export function matchLatency(
  planned: readonly number[],
  onsets: readonly number[],
  { minMs = -50, maxMs = 2000, toleranceMs = 15 }: { minMs?: number; maxMs?: number; toleranceMs?: number } = {},
): LatencyMatch | null {
  const candidates: number[] = []
  for (const s of planned) for (const o of onsets) if (o - s >= minMs && o - s <= maxMs) candidates.push(o - s)
  if (candidates.length === 0) return null

  const score = (delay: number) => {
    const diffs: number[] = []
    for (const s of planned) {
      let best: number | null = null
      for (const o of onsets) {
        const d = o - s
        if (Math.abs(d - delay) <= toleranceMs && (best === null || Math.abs(d - delay) < Math.abs(best - delay))) best = d
      }
      if (best !== null) diffs.push(best)
    }
    return diffs
  }

  let bestDelay = candidates[0]!
  let bestDiffs = score(bestDelay)
  for (const delay of candidates) {
    const diffs = score(delay)
    const spread = (xs: number[]) => xs.reduce((sum, x) => sum + Math.abs(x - delay), 0) / xs.length
    if (diffs.length > bestDiffs.length || (diffs.length === bestDiffs.length && spread(diffs) < spread(bestDiffs))) {
      bestDelay = delay
      bestDiffs = diffs
    }
  }
  let runnerUp = 0
  for (const delay of candidates) if (Math.abs(delay - bestDelay) > 50) runnerUp = Math.max(runnerUp, score(delay).length)

  const sorted = [...bestDiffs].sort((a, b) => a - b)
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
  const jitter = Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length)
  return {
    latencyMs: median,
    jitterMs: jitter,
    matched: sorted.length,
    total: planned.length,
    runnerUp,
    reliable: sorted.length >= Math.ceil(planned.length * 0.6) && runnerUp <= sorted.length / 2,
  }
}
