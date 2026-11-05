import { timeBase } from './timeBase'

/**
 * How fast audio that follows the song clock plays (docs/29 §5.5, step 2): the audio clock's own
 * rate against the wall clock, measured by the time service (Redmi in the app −247 ppm = 15 ms a
 * minute behind, docs/29 §11), fed forward - plus a gentle pull on what is left, the error spread
 * over RATE_TIME_CONSTANT_S. Never more than MAX_RATE_DEVIATION of pull: 0.1 % is 1.7 cents, not
 * heard. Used by the Gig track (webAudioTrackEngine.ts) and the Solo stems (stemEngine.ts).
 */
export const RATE_TIME_CONSTANT_S = 8
export const MAX_RATE_DEVIATION = 0.001
/** Below this a new rate isn't worth a new segment. */
export const RATE_STEP = 0.00002

/** Song seconds per audio second for audio `errorS` ahead of the song clock (negative: behind). */
export function driftRate(ctx: AudioContext, errorS: number): number {
  const pull = 1 - Math.max(-MAX_RATE_DEVIATION, Math.min(MAX_RATE_DEVIATION, errorS / RATE_TIME_CONSTANT_S))
  return pull / timeBase.audioPerWall(ctx)
}
