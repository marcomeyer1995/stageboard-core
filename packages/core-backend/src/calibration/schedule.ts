/**
 * Click times for a latency calibration (docs/21 §4, #491) - deliberately *irregular*: with one
 * click per second the latency is only known modulo a second (a click 1.2 s late lands next to the
 * following second and reads as 0.2 s - Marco, 2026-10-13). Every gap here is different, so only
 * the true delay makes the whole detected sequence line up with the planned one (matchLatency.ts).
 */
export const CALIBRATION_GAPS_MS = [700, 780, 860, 940, 1020, 1100, 1180, 1260, 1340, 1420, 1500] as const

/** `count` server times from `startAt`, separated by the distinct gaps above in a shuffled order. */
export function irregularSchedule(startAt: number, count: number, random: () => number = Math.random): number[] {
  const gaps = [...CALIBRATION_GAPS_MS]
  for (let i = gaps.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[gaps[i], gaps[j]] = [gaps[j]!, gaps[i]!]
  }
  const times = [startAt]
  for (let i = 1; i < count; i++) times.push(times[i - 1]! + gaps[(i - 1) % gaps.length]!)
  return times
}
