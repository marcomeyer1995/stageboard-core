import { useMemo } from 'react'
import { clickTimeline } from './beatGrid'
import { levelAt, trackLevelCurve, type LevelPoint } from './playbackCues'
import type { Queue } from './computeQueue'

/** How far ahead the level is scheduled on every sync - longer than any stall between two. */
export const LEVEL_AHEAD_S = 1

/**
 * The backing track's level curve of the song in `queue` (#485), from its playback cues. Fades in
 * beats and bars follow the song's own grid (the track's tempo - a live tempo nudge changes only
 * the click). Shared by the Gig's track (useAudioOutputDriver) and Solo's (useStemPlaybackDriver).
 */
export function useTrackLevelCurve(queue: Queue): LevelPoint[] {
  const { currentArrangement, currentVariant } = queue
  const bpm = currentArrangement?.bpm
  const meter = currentArrangement?.timeSignature
  const cues = currentVariant?.cues
  const grid = currentVariant?.beatGrid
  return useMemo(
    () => trackLevelCurve(cues ?? [], bpm && meter ? clickTimeline({ beatGrid: grid, bpm, timeSignature: meter }) : null),
    [cues, grid, bpm, meter],
  )
}

/**
 * Schedules the level on `param` from the song time `songNow` (heard at audio time `now`)
 * LEVEL_AHEAD_S ahead: the value now, then a linear ramp to every point of the curve in that
 * window - the curve is linear between its points, so this is exact. Replaces what was scheduled
 * before; a seek or jump just continues from the new song time.
 */
export function scheduleTrackLevel(param: AudioParam, ctx: BaseAudioContext, now: number, songNow: number, curve: readonly LevelPoint[]): void {
  const t = Math.max(now, ctx.currentTime)
  const songT = songNow + (t - now)
  param.cancelScheduledValues(t)
  param.setValueAtTime(levelAt(curve, songT * 1000), t)
  if (curve.length === 0) return
  for (const point of curve) {
    const at = point.timeMs / 1000
    if (at > songT && at < songT + LEVEL_AHEAD_S) param.linearRampToValueAtTime(point.gain, t + (at - songT))
  }
  param.linearRampToValueAtTime(levelAt(curve, (songT + LEVEL_AHEAD_S) * 1000), t + LEVEL_AHEAD_S)
}
