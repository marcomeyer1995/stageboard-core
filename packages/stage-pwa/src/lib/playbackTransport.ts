import type { PlaybackStatus, ShowState } from 'shared-types'

export type { PlaybackStatus }

/** The playback-transport slice of ShowState - see shared-types/src/showState.ts for the
 * field-by-field reasoning. Small enough to pass around as its own value rather than the
 * whole ShowState, and pure functions over it are trivial to unit-test in isolation. */
export interface TransportState {
  status: PlaybackStatus
  startedAt: number | null
  accumulatedMs: number
  /** A queued or just-passed section jump (#479, ShowState.playbackJump): from server time `at`
   * on, song time continues at `toMs`. */
  jump?: SectionJump | null
  /** Song time leapt over by passed jumps (ShowState.playbackSkippedMs) - forward +, back −. */
  skippedMs?: number
}

export interface SectionJump {
  at: number
  toMs: number
  label?: string
}

/** The transport slice of a show state. */
export function transportOf(state: ShowState): TransportState {
  return { status: state.playbackStatus, startedAt: state.playbackStartedAt, accumulatedMs: state.playbackAccumulatedMs, jump: state.playbackJump ?? null, skippedMs: state.playbackSkippedMs ?? 0 }
}

/** "Unarmed": no time accumulated, nothing running. What Reset always returns to, and what a
 * freshly activated entry starts as. */
export const ARMED_TRANSPORT: TransportState = { status: 'stopped', startedAt: null, accumulatedMs: 0, jump: null, skippedMs: 0 }

/** Net active elapsed ms for the current play-through - the accumulated total, plus whatever
 * has elapsed since the current run began if still playing. Paused/stopped time is never
 * included, by construction (#13). */
export function computeActiveMs(state: TransportState, now: number): number {
  if (state.status === 'playing' && state.startedAt !== null) {
    // Past a section jump (#479) the song continues at its target.
    if (state.jump && now >= state.jump.at) return state.jump.toMs + (now - state.jump.at)
    return state.accumulatedMs + Math.max(0, now - state.startedAt)
  }
  return state.accumulatedMs
}

/** The song time a queued jump leaves from - the boundary in the song as it runs now (#479). Null
 * without a jump or while not playing. */
export function jumpBoundaryMs(state: TransportState): number | null {
  if (!state.jump || state.status !== 'playing' || state.startedAt === null) return null
  return state.accumulatedMs + (state.jump.at - state.startedAt)
}

/** The same song clock without the passed jump: anchored on it (#479). Unchanged before the jump. */
export function foldJump(state: TransportState, now: number): TransportState {
  if (!state.jump || now < state.jump.at || state.status !== 'playing' || state.startedAt === null) return state
  const boundary = state.accumulatedMs + (state.jump.at - state.startedAt)
  return { status: 'playing', startedAt: state.jump.at, accumulatedMs: state.jump.toMs, jump: null, skippedMs: (state.skippedMs ?? 0) + (state.jump.toMs - boundary) }
}

/** The time really played (#64, Marco 2026-10-29): song time without what jumps leapt over -
 * a skipped part doesn't count, a looped chorus counts each time. Paused time never does. */
export function computePlayedMs(state: TransportState, now: number): number {
  const folded = foldJump(state, now)
  return computeActiveMs(folded, now) - (folded.skippedMs ?? 0)
}

/** Starts or resumes - a no-op if already playing, so re-pressing Play mid-song never resets
 * the accumulated position. */
export function play(state: TransportState, now: number): TransportState {
  if (state.status === 'playing') return state
  return { status: 'playing', startedAt: now, accumulatedMs: state.accumulatedMs, jump: null, skippedMs: state.skippedMs ?? 0 }
}

/** Freezes the current position for a later resume - a no-op unless currently playing. */
export function pause(state: TransportState, now: number): TransportState {
  if (state.status !== 'playing') return state
  // A jump not reached yet is dropped - after Pause the song resumes where it stood. One already
  // passed is folded first, so what it skipped is kept.
  const folded = foldJump(state, now)
  return { status: 'paused', startedAt: null, accumulatedMs: computeActiveMs(folded, now), jump: null, skippedMs: folded.skippedMs ?? 0 }
}

/** Rearms: back to 0. Both Reset (no log) and Stop (queue.ts's stopSong logs first, from the
 * pre-reset state, then calls this) end up here - "this take is over" always means starting
 * the next one, if any, completely fresh. */
export function reset(): TransportState {
  return { ...ARMED_TRANSPORT }
}

/** `skipCountIn`: start the entry at position 0 instead of seeding its count-in lead - a seamless
 * transition (#232) is already in time, so a count-in there would only delay the segue. */
export interface PlayOptions {
  skipCountIn?: boolean
}

/** How far ahead of Play a fresh song start lies (docs/00 §4 "Ahead-of-Time Dispatch") - long
 * enough for the Play to reach every device over Wi-Fi and for each to schedule its audio. Solo
 * practice uses it too: its Web Audio track and stems need the same lead (2026-10-15). */
export const PLAY_LEAD_MS = 400
