import type { PlaybackStatus } from 'shared-types'

export type { PlaybackStatus }

/** The playback-transport slice of ShowState - see shared-types/src/showState.ts for the
 * field-by-field reasoning. Small enough to pass around as its own value rather than the
 * whole ShowState, and pure functions over it are trivial to unit-test in isolation. */
export interface TransportState {
  status: PlaybackStatus
  startedAt: number | null
  accumulatedMs: number
}

/** "Unarmed": no time accumulated, nothing running. What Reset always returns to, and what a
 * freshly activated entry starts as. */
export const ARMED_TRANSPORT: TransportState = { status: 'stopped', startedAt: null, accumulatedMs: 0 }

/** Net active elapsed ms for the current play-through - the accumulated total, plus whatever
 * has elapsed since the current run began if still playing. Paused/stopped time is never
 * included, by construction (#13). */
export function computeActiveMs(state: TransportState, now: number): number {
  if (state.status === 'playing' && state.startedAt !== null) {
    return state.accumulatedMs + Math.max(0, now - state.startedAt)
  }
  return state.accumulatedMs
}

/** Starts or resumes - a no-op if already playing, so re-pressing Play mid-song never resets
 * the accumulated position. */
export function play(state: TransportState, now: number): TransportState {
  if (state.status === 'playing') return state
  return { status: 'playing', startedAt: now, accumulatedMs: state.accumulatedMs }
}

/** Freezes the current position for a later resume - a no-op unless currently playing. */
export function pause(state: TransportState, now: number): TransportState {
  if (state.status !== 'playing') return state
  return { status: 'paused', startedAt: null, accumulatedMs: computeActiveMs(state, now) }
}

/** Rearms: back to 0. Both Reset (no log) and Stop (queue.ts's stopSong logs first, from the
 * pre-reset state, then calls this) end up here - "this take is over" always means starting
 * the next one, if any, completely fresh. */
export function reset(): TransportState {
  return { ...ARMED_TRANSPORT }
}
