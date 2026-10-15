/**
 * Beat tracking by dynamic programming (after Ellis 2007, "Beat Tracking by Dynamic Programming"):
 * the best chain of beats from a known beat on, each one landing on an onset where it can. A band
 * without a click wanders - All the small things moves between 146 and 150.5 BPM (2026-10-15) -
 * which fixed points and one tempo can't follow. Unlike Ellis, a beat's spacing is weighed against
 * the *previous* spacing, not one global tempo: the tempo may settle somewhere new (120 → 126 BPM
 * costs once, then nothing), but it can't jump. Starting from a beat the musician set (bar 1)
 * keeps the chain on the beat: moving to the offbeat would need one spacing half a beat off,
 * which costs far more than any onset gains - where a search over single bars, with onsets on
 * the eighths too, could not tell beat from offbeat.
 */

/** Analysis frame, ms. */
const FRAME_MS = 5
/** An onset's pull on nearby frames: a Gaussian of this width, ms. */
const ONSET_SIGMA_MS = 12
/** How far a spacing may be from the expected period at all. */
const MAX_PERIOD_CHANGE = 0.2
/** Cost of a spacing that differs from the one before (log-ratio squared): a 1 % step costs
 * ~0.1 of an onset, 5 % ~2.4, half a beat ~160. */
const STEP_COST = 1000
/** A weak pull towards the expected period, so silence doesn't let the tempo float away. */
const PERIOD_COST = 10
/** A tracked beat this close to an onset is put onto it. */
const SNAP_MS = 15

/**
 * Beat times from `startMs` (a beat known to be right) up to `endMs`, about `periodMs` apart.
 * The first beat is `startMs` itself.
 */
export function trackBeats(onsetsMs: readonly number[], startMs: number, periodMs: number, endMs: number): number[] {
  const n = Math.ceil(endMs / FRAME_MS) + 1
  const t0 = Math.round(startMs / FRAME_MS)
  if (t0 >= n || periodMs <= 0) return [startMs]
  const strength = new Float32Array(n)
  const reach = Math.ceil((3 * ONSET_SIGMA_MS) / FRAME_MS)
  for (const onset of onsetsMs) {
    const centre = Math.round(onset / FRAME_MS)
    for (let d = -reach; d <= reach; d++) {
      const i = centre + d
      if (i < 0 || i >= n) continue
      strength[i] = Math.max(strength[i]!, Math.exp(-((d * FRAME_MS) ** 2) / (2 * ONSET_SIGMA_MS ** 2)))
    }
  }
  // The spacings a beat may have, in frames.
  const lo = Math.max(1, Math.round((periodMs * (1 - MAX_PERIOD_CHANGE)) / FRAME_MS))
  const hi = Math.round((periodMs * (1 + MAX_PERIOD_CHANGE)) / FRAME_MS)
  const taus = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  const k = taus.length
  const periodCost = taus.map((tau) => PERIOD_COST * Math.log((tau * FRAME_MS) / periodMs) ** 2)
  const stepCost = taus.map((a) => taus.map((b) => STEP_COST * Math.log(a / b) ** 2))
  // score[t * k + j]: best chain whose last beat is at frame t, reached with spacing taus[j].
  const score = new Float32Array(n * k).fill(-Infinity)
  const back = new Int16Array(n * k).fill(-1)
  for (let t = t0 + lo; t < n; t++) {
    const onset = strength[t]!
    for (let j = 0; j < k; j++) {
      const p = t - taus[j]!
      if (p < t0) continue
      let best: number
      let from = -1
      if (p === t0) best = 0
      else {
        best = -Infinity
        const row = p * k
        const cost = stepCost[j]!
        for (let i = 0; i < k; i++) {
          const v = score[row + i]! - cost[i]!
          if (v > best) {
            best = v
            from = i
          }
        }
        if (best === -Infinity) continue
      }
      score[t * k + j] = onset + best - periodCost[j]!
      back[t * k + j] = from
    }
  }
  // End on the best beat within the last spacing.
  let endT = -1
  let endJ = -1
  for (let t = Math.max(t0 + lo, n - hi); t < n; t++)
    for (let j = 0; j < k; j++) if (endT < 0 || score[t * k + j]! > score[endT * k + endJ]!) [endT, endJ] = [t, j]
  if (endT < 0 || score[endT * k + endJ] === -Infinity) return [startMs]
  const beats: number[] = []
  let t = endT
  let j = endJ
  while (t > t0) {
    beats.push(t * FRAME_MS)
    const prevJ = back[t * k + j]!
    t -= taus[j]!
    j = prevJ
  }
  beats.push(startMs)
  beats.reverse()
  // The chain lives on 5 ms frames - each beat goes onto the onset right next to it, if any.
  const sorted = [...onsetsMs].sort((x, y) => x - y)
  return beats.map((beat, i) => {
    if (i === 0) return beat
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid]! < beat) lo = mid + 1
      else hi = mid
    }
    const near = [sorted[lo - 1], sorted[lo]].filter((x): x is number => x !== undefined && Math.abs(x - beat) <= SNAP_MS)
    return near.length ? near.reduce((x, y) => (Math.abs(x - beat) <= Math.abs(y - beat) ? x : y)) : beat
  })
}
