import type { PendingSong } from 'shared-types'
import type { CapabilityStatus } from './capabilities'

export type { PendingSong }

/** A wrong-song tap corrected within a few seconds shouldn't count as "played". */
export const MIN_SONG_DURATION_MS = 20_000

/** Long enough to survive a normal set break; short enough that the next day's
 * soundcheck starts a fresh show rather than continuing yesterday's. */
export const SHOW_GAP_THRESHOLD_MS = 45 * 60_000

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

/** The subset of `ShowState` that in-flight song tracking reads/writes - persisted centrally
 * so any tablet holding the Master-Token can pick it up, rather than living in one tablet's
 * own React refs (#4: the previous per-device-ref design lost the play record whenever the
 * Master-Token changed hands mid-song, since the incoming master had no way to know a song
 * was already in progress). */
export interface SongTrackingState {
  pendingSong: PendingSong | null
  currentShowId: string | null
  lastActivityAt: number | null
}

export interface SongTrackingEvents {
  songPlayed: { showId: string; songId: string; songTitle: string; at: number; endedAt: number } | null
  showStarted: { showId: string; at: number } | null
}

/**
 * Pure decision for what happens when the queue's active entry changes - either a genuinely
 * new song, or a Master-Token handoff revealing tracking state a fresh master didn't create
 * itself. Returns `null` when `entry` is already the one recorded in `state.pendingSong`: the
 * caller should do nothing and keep waiting, rather than resetting the confirmation timer -
 * this is what makes a mid-song handoff lossless instead of restarting the 20-second window.
 */
export function advanceSongTracking(
  state: SongTrackingState,
  entry: { id: string; songId: string; songTitle: string },
  now: number,
  newShowId: string,
): { events: SongTrackingEvents; nextState: SongTrackingState } | null {
  if (state.pendingSong && state.pendingSong.entryId === entry.id) return null

  const songPlayed =
    state.pendingSong && state.currentShowId && shouldConfirmSong(state.pendingSong, now)
      ? {
          showId: state.currentShowId,
          songId: state.pendingSong.songId,
          songTitle: state.pendingSong.songTitle,
          at: state.pendingSong.startedAt,
          endedAt: now,
        }
      : null

  const startsNewShow = shouldStartNewShow(state.lastActivityAt, now)
  const showId = startsNewShow ? newShowId : state.currentShowId
  const showStarted = startsNewShow ? { showId: newShowId, at: now } : null

  return {
    events: { songPlayed, showStarted },
    nextState: {
      pendingSong: { entryId: entry.id, songId: entry.songId, songTitle: entry.songTitle, startedAt: now },
      currentShowId: showId,
      lastActivityAt: now,
    },
  }
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
