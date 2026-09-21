import type { DetectedOnset } from './audioAnalysis'

/** Snapping never moves a cue further than this, whatever the caller asks for. */
export const MAX_SNAP_WINDOW_MS = 250

/**
 * The onset nearest to `timeMs` within `windowMs` either side (#7), or null when none is close
 * enough. Nearest, not strongest: a cue was placed where the player meant it, so the attack
 * closest to that moment is the one that moment was aiming at. `onsets` must be time-ordered
 * (detectOnsets returns them so).
 */
export function snapToOnset(timeMs: number, onsets: readonly DetectedOnset[], windowMs: number): DetectedOnset | null {
  const window = Math.min(Math.max(0, windowMs), MAX_SNAP_WINDOW_MS)
  const nearest = nearestOnset(timeMs, onsets)
  return nearest !== null && Math.abs(nearest.timeMs - timeMs) <= window ? nearest : null
}

/** The onset closest to `timeMs`, however far away (or null with no onsets) - scoring needs the
 * true distance, snapping wraps it with a window. */
function nearestOnset(timeMs: number, onsets: readonly DetectedOnset[]): DetectedOnset | null {
  let nearest: DetectedOnset | null = null
  let nearestDistance = Infinity
  // Binary search for the first onset at/after timeMs, then look at both neighbours.
  let low = 0
  let high = onsets.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (onsets[mid]!.timeMs < timeMs) low = mid + 1
    else high = mid
  }
  for (const index of [low - 1, low]) {
    const candidate = onsets[index]
    if (!candidate) continue
    const distance = Math.abs(candidate.timeMs - timeMs)
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return nearest
}

export interface SnappedCue<T extends { timeMs: number }> {
  /** The cue with its snapped time (unchanged when nothing was in range). */
  cue: T
  /** How far it moved, in ms (signed); 0 when it stayed. */
  shiftMs: number
}

/** Snaps each cue to the nearest onset in range. Cues with nothing in range stay exactly where
 * they are - snapping is only ever an improvement the caller can see (`shiftMs`), never a guess. */
export function snapCues<T extends { timeMs: number }>(cues: readonly T[], onsets: readonly DetectedOnset[], windowMs: number): SnappedCue<T>[] {
  return cues.map((cue) => {
    const onset = snapToOnset(cue.timeMs, onsets, windowMs)
    if (!onset) return { cue, shiftMs: 0 }
    const timeMs = Math.round(onset.timeMs)
    return { cue: { ...cue, timeMs }, shiftMs: timeMs - cue.timeMs }
  })
}

export interface AlignmentScore {
  count: number
  /** Median distance from a boundary to its nearest onset, in ms. */
  medianErrorMs: number | null
  /** tolerance (ms) -> fraction (0-1) of boundaries with an onset that close. */
  hitRates: Record<number, number>
}

/**
 * How well `boundariesMs` (known section starts) line up with detected onsets - the measurement
 * behind the real validation of #7 (tracked in its own follow-up issue): for each boundary the
 * distance to the nearest onset, summarised as a median and as hit rates at each tolerance.
 */
export function scoreAlignment(boundariesMs: readonly number[], onsets: readonly DetectedOnset[], tolerancesMs: readonly number[] = [50, 100, 200]): AlignmentScore {
  const errors = boundariesMs.map((boundary) => {
    const nearest = nearestOnset(boundary, onsets)
    return nearest ? Math.abs(nearest.timeMs - boundary) : Infinity
  })
  const finite = errors.filter(Number.isFinite).sort((a, b) => a - b)
  return {
    count: boundariesMs.length,
    medianErrorMs: finite.length > 0 ? finite[Math.floor((finite.length - 1) / 2)]! : null,
    hitRates: Object.fromEntries(tolerancesMs.map((tolerance) => [tolerance, boundariesMs.length === 0 ? 0 : errors.filter((error) => error <= tolerance).length / boundariesMs.length])),
  }
}

/**
 * The same score for `count` uniformly random times in `[0, durationMs]` - the baseline that
 * shows whether a hit rate is signal or just what a dense onset list gives for free. `random`
 * is injectable (a seeded generator) so the result is reproducible.
 */
export function randomBaseline(
  count: number,
  durationMs: number,
  onsets: readonly DetectedOnset[],
  tolerancesMs: readonly number[] = [50, 100, 200],
  random: () => number = Math.random,
): AlignmentScore {
  return scoreAlignment(Array.from({ length: count }, () => random() * durationMs), onsets, tolerancesMs)
}
