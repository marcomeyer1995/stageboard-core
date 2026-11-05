/** The beats (their band time) of a session from `fromMs` (exclusive) to `toMs` (inclusive). */
export function alignmentBeatsDue(startedAt: number, periodMs: number, fromMs: number, toMs: number): number[] {
  const beats: number[] = []
  const first = Math.max(0, Math.floor((fromMs - startedAt) / periodMs) + 1)
  for (let k = first; startedAt + k * periodMs <= toMs; k++) beats.push(startedAt + k * periodMs)
  return beats
}

/** The middle of two bracketing marks (docs/21 §4): where the flam was just audible on each side. */
export function bracketMiddle(a: number, b: number): number {
  return Math.round((a + b) / 2)
}
