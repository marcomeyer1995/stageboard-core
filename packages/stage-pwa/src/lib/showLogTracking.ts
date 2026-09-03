import type { CapabilityStatus } from './capabilities'

/** A wrong-song tap corrected within a few seconds shouldn't count as "played". */
export const MIN_SONG_DURATION_MS = 20_000

/** Long enough to survive a normal set break; short enough that the next day's
 * soundcheck starts a fresh show rather than continuing yesterday's. */
export const SHOW_GAP_THRESHOLD_MS = 45 * 60_000

/** Whether an entry's active (unpaused) elapsed time is long enough to log as actually
 * played - see ShowState.playbackAccumulatedMs (#13): paused/stopped spans never count
 * toward this, unlike a bare wall-clock duration would. */
export function shouldConfirmSong(activeMs: number, minDurationMs: number = MIN_SONG_DURATION_MS): boolean {
  return activeMs >= minDurationMs
}

/** Whether enough time has passed with no activity that a new show should start. */
export function shouldStartNewShow(
  lastActivityAt: number | null,
  now: number,
  gapThresholdMs: number = SHOW_GAP_THRESHOLD_MS,
): boolean {
  if (lastActivityAt === null) return true
  return now - lastActivityAt >= gapThresholdMs
}

export interface SongPlayed {
  showId: string
  songId: string
  songTitle: string
  at: number
  endedAt: number
  activeMs: number
}

/**
 * Whether an ended play-through should be logged, and with what payload - null when the
 * active (unpaused) duration never crossed the minimum threshold (a wrong-song tap corrected
 * within a few seconds, or a Reset before the threshold, shouldn't count as "played"). Pure
 * decision, called from queue.ts wherever a play-through actually ends: advancing the queue,
 * or an explicit Stop (#13) - not inferred reactively from state diffs, since it's always a
 * direct consequence of one of those actions.
 */
export function finalizeSongPlay(
  entry: { songId: string; songTitle: string },
  startedAt: number,
  activeMs: number,
  endedAt: number,
  showId: string,
): SongPlayed | null {
  if (!shouldConfirmSong(activeMs)) return null
  return { showId, songId: entry.songId, songTitle: entry.songTitle, at: startedAt, endedAt, activeMs }
}

export interface CapabilityTransition {
  capability: string
  from: CapabilityStatus
  to: CapabilityStatus
}

/**
 * Every capability whose status changed between two snapshots - the "technical event"
 * source (docs: lost connections, equipment going unreachable). Deliberately only
 * considers capabilities present in *both* snapshots: a capability appearing or
 * disappearing entirely means a plugin was installed/uninstalled, an intentional admin
 * action, not equipment failing mid-show.
 */
export function diffCapabilities(
  previous: Map<string, CapabilityStatus>,
  current: Map<string, CapabilityStatus>,
): CapabilityTransition[] {
  const transitions: CapabilityTransition[] = []
  for (const [capability, to] of current) {
    const from = previous.get(capability)
    if (from !== undefined && from !== to) transitions.push({ capability, from, to })
  }
  return transitions
}
