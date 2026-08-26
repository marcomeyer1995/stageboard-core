import type { CapabilityStatus } from './capabilities'

/** A wrong-song tap corrected within a few seconds shouldn't count as "played". */
export const MIN_SONG_DURATION_MS = 20_000

/** Long enough to survive a normal set break; short enough that the next day's
 * soundcheck starts a fresh show rather than continuing yesterday's. */
export const SHOW_GAP_THRESHOLD_MS = 45 * 60_000

export interface PendingSong {
  /** The setlist entry this play-through belongs to - distinguishes two occurrences of the
   * same song (e.g. full version then a shortened encore) from one continuous play. */
  entryId: string
  songId: string
  songTitle: string
  startedAt: number
}

/** Whether a pending song has been active long enough to log as actually played. */
export function shouldConfirmSong(
  pending: PendingSong,
  now: number,
  minDurationMs: number = MIN_SONG_DURATION_MS,
): boolean {
  return now - pending.startedAt >= minDurationMs
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
