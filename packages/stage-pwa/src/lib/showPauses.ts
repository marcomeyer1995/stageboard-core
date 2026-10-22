import { DEFAULT_PAUSE_BETWEEN_SONGS_MS, type ShowLogEvent } from 'shared-types'

type SongPlayed = Extract<ShowLogEvent, { type: 'song-played' }>

/** A pause this much longer than planned is marked (#64, Marco 2026-10-22: planned + 15 s). */
export const PAUSE_TOLERANCE_MS = 15_000

/**
 * The dead air before `song` (#64): from the end of the song before until this one played -
 * the time between them plus what its own span spent not playing (waiting for Play, the count-in,
 * an interruption). Compared with the pause the setlist planned after the song before.
 */
export function pauseBefore(previous: SongPlayed, song: SongPlayed): { ms: number; plannedMs: number | null; tooLong: boolean } {
  const idleInSpan = Math.max(0, song.endedAt - song.at - song.activeMs)
  const ms = Math.max(0, song.at - previous.endedAt) + idleInSpan
  const plannedMs = previous.plannedPauseAfterMs ?? null
  return { ms, plannedMs, tooLong: ms > (plannedMs ?? DEFAULT_PAUSE_BETWEEN_SONGS_MS) + PAUSE_TOLERANCE_MS }
}
