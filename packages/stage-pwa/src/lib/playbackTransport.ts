import { DEFAULT_PLAY_LEAD_MS, type PlaybackStatus, type ShowState } from 'shared-types'

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
  /** How fast song time runs against the clock (#683, Solo Üben's loop trainer): 0.8 = an 80 %
   * pass. Absent means 1 - always in the Gig, where the band's clock never slows. */
  rate?: number
}

export interface SectionJump {
  at: number
  toMs: number
  label?: string
  /** The speed from the jump on (#683: the loop trainer's next pass). Absent: unchanged. */
  rate?: number
}

/** The speed of a transport (#683). */
export function rateOf(state: Pick<TransportState, 'rate'>): number {
  return state.rate ?? 1
}

/** The speed after a jump - its own, or the one before. */
function rateAfter(state: TransportState): number {
  return state.jump?.rate ?? rateOf(state)
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
    if (state.jump && now >= state.jump.at) return state.jump.toMs + (now - state.jump.at) * rateAfter(state)
    return state.accumulatedMs + Math.max(0, now - state.startedAt) * rateOf(state)
  }
  return state.accumulatedMs
}

/** The song time a queued jump leaves from - the boundary in the song as it runs now (#479). Null
 * without a jump or while not playing. */
export function jumpBoundaryMs(state: TransportState): number | null {
  if (!state.jump || state.status !== 'playing' || state.startedAt === null) return null
  return state.accumulatedMs + (state.jump.at - state.startedAt) * rateOf(state)
}

/** The clock time at which a playing transport reaches song time `songMs` (before any jump) -
 * null unless playing. */
export function clockTimeAt(state: TransportState, songMs: number): number | null {
  if (state.status !== 'playing' || state.startedAt === null) return null
  return state.startedAt + (songMs - state.accumulatedMs) / rateOf(state)
}

/** The same song clock without the passed jump: anchored on it (#479). Unchanged before the jump. */
export function foldJump(state: TransportState, now: number): TransportState {
  if (!state.jump || now < state.jump.at || state.status !== 'playing' || state.startedAt === null) return state
  const boundary = state.accumulatedMs + (state.jump.at - state.startedAt) * rateOf(state)
  return {
    status: 'playing',
    startedAt: state.jump.at,
    accumulatedMs: state.jump.toMs,
    jump: null,
    skippedMs: (state.skippedMs ?? 0) + (state.jump.toMs - boundary),
    ...withRate(rateAfter(state)),
  }
}

/** The time really played (#64, Marco 2026-10-29): song time without what jumps leapt over -
 * a skipped part doesn't count, a looped chorus counts each time. Paused time never does. */
export function computePlayedMs(state: TransportState, now: number): number {
  const folded = foldJump(state, now)
  return computeActiveMs(folded, now) - (folded.skippedMs ?? 0)
}

/** `rate` only when it isn't 1 - a Gig transport never carries one. */
function withRate(rate: number): { rate?: number } {
  return rate === 1 ? {} : { rate }
}

/** Starts or resumes - a no-op if already playing, so re-pressing Play mid-song never resets
 * the accumulated position. */
export function play(state: TransportState, now: number): TransportState {
  if (state.status === 'playing') return state
  return { status: 'playing', startedAt: now, accumulatedMs: state.accumulatedMs, jump: null, skippedMs: state.skippedMs ?? 0, ...withRate(rateOf(state)) }
}

/** Freezes the current position for a later resume - a no-op unless currently playing. */
export function pause(state: TransportState, now: number): TransportState {
  if (state.status !== 'playing') return state
  // A jump not reached yet is dropped - after Pause the song resumes where it stood. One already
  // passed is folded first, so what it skipped is kept.
  const folded = foldJump(state, now)
  return { status: 'paused', startedAt: null, accumulatedMs: computeActiveMs(folded, now), jump: null, skippedMs: folded.skippedMs ?? 0, ...withRate(rateOf(folded)) }
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

/** The Play lead without a band setting (docs/00 §4 "Ahead-of-Time Dispatch") - what a fresh song
 * start uses is the band's value, playLead.ts. 400 ms until 2026-11-06: too short for the native
 * output (Fire 483 ms delay), its first click and announcement came 100-300 ms late. */
export const PLAY_LEAD_MS = DEFAULT_PLAY_LEAD_MS
