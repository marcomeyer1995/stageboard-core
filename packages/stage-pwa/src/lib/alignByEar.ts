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

/** Beats per bar - the first is accented on both devices, so a click shifted by whole beats no
 * longer sounds "together" (Marco merged two wrong clicks, 2026-11-05). */
export const ALIGN_BAR = 4
/** The value moves at most this far from where it started - less than half a beat (600 ms). */
export const ALIGN_RANGE_MS = 250

/** Two sounds: the reference a lower "tock", the target a high "tick" - you hear which comes first,
 * and the microphone tells them apart. No integer ratio between them (no shared harmonics), and
 * both where small speakers and the ear are strong: at 800 Hz the tablets were ~9 dB quieter than
 * the laptop, too quiet to align by ear (Marco, 2026-11-05). */
export const ALIGN_SOUND = { reference: { hz: 1200 }, target: { hz: 3000 } } as const

/** Whether the beat at band time `beatMs` is the first of its bar. */
export function isAlignAccent(startedAt: number, periodMs: number, beatMs: number): boolean {
  return Math.round((beatMs - startedAt) / periodMs) % ALIGN_BAR === 0
}

/** A value kept within ALIGN_RANGE_MS of the one the session started with. */
export function clampAlignValue(value: number, startValue: number): number {
  return Math.max(startValue - ALIGN_RANGE_MS, Math.min(startValue + ALIGN_RANGE_MS, value))
}

/**
 * The target's offset against the reference for every target click heard (ms, + = target late):
 * each paired with the nearest reference click within `maxMs`; clicks without a partner are left out.
 */
export function pairOffsets(referenceS: readonly number[], targetS: readonly number[], maxMs = ALIGN_RANGE_MS): number[] {
  const out: number[] = []
  for (const t of targetS) {
    let best: number | null = null
    for (const r of referenceS) if (best === null || Math.abs(t - r) < Math.abs(t - best)) best = r
    if (best !== null && Math.abs(t - best) * 1000 <= maxMs) out.push((t - best) * 1000)
  }
  return out
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Both devices' clicks as heard, each against the reference's own beat grid (ms; the grid fitted
 * through the reference clicks at the session's period): the reference's dots sit around 0 by its
 * jitter, the target's at its offset - one lane each in the dialog. The last `count` of each.
 */
export function laneOffsets(referenceS: readonly number[], targetS: readonly number[], periodMs: number, count = 8): { reference: number[]; target: number[] } {
  if (referenceS.length === 0) return { reference: [], target: [] }
  const period = periodMs / 1000
  const first = referenceS[0]!
  const phase = median(referenceS.map((r) => r - first - Math.round((r - first) / period) * period))!
  const grid = (x: number) => first + phase + Math.round((x - first - phase) / period) * period
  const near = (x: number) => (x - grid(x)) * 1000
  return { reference: referenceS.slice(-count).map(near), target: targetS.slice(-count).map(near) }
}
