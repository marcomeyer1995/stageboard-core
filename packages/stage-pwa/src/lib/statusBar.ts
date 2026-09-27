import type { PlaybackStatus } from 'shared-types'
import type { SessionMode } from '../store/useAppModeStore'
import type { SyncStatus } from '../store/useSyncStore'

/**
 * The status bar's state (PR F2 of the stage GUI audit, colours agreed with Marco 2026-09-27):
 * grey = ready/stopped, blue = count-in, green = playing, amber = paused, magenta = song
 * finished, red only for faults - stopped is the normal state between songs, so red there would
 * make a real fault easy to miss. Always shown as colour *and* word; stage lighting shifts
 * colours and not every musician tells red from green.
 */
export type StatusBarKind = 'ready' | 'count-in' | 'playing' | 'paused' | 'finished' | 'fault'

export interface StatusBarState {
  kind: StatusBarKind
  label: string
}

export interface StatusBarInput {
  mode: SessionMode
  playbackStatus: PlaybackStatus
  /** Playing, but still in the count-in bars before the song's first beat. */
  isCountIn: boolean
  /** Stopped after the last run reached the song's end (see finishedAfterRun). */
  finished: boolean
  /** Gig mode: nobody holds the Master token, so nobody can start the next song. */
  noMaster: boolean
  syncStatus: SyncStatus
  /** The local audio driver's current error, if any. */
  audioError: string | null
}

/** Faults first (they matter most, whatever the transport does), then the transport state.
 * Offline only counts in Gig mode - Solo Üben runs fine without the Stage-Server. */
export function statusBarState(input: StatusBarInput): StatusBarState {
  if (input.audioError) return { kind: 'fault', label: 'Audio-Fehler' }
  if (input.syncStatus === 'error') return { kind: 'fault', label: 'Sync-Fehler' }
  if (input.mode === 'gig' && input.syncStatus === 'offline') return { kind: 'fault', label: 'Offline' }
  if (input.mode === 'gig' && input.noMaster) return { kind: 'fault', label: 'Kein Master' }
  if (input.playbackStatus === 'playing') {
    return input.isCountIn ? { kind: 'count-in', label: 'Einzählen' } : { kind: 'playing', label: 'Spielt' }
  }
  if (input.playbackStatus === 'paused') return { kind: 'paused', label: 'Pause' }
  return input.finished ? { kind: 'finished', label: 'Beendet' } : { kind: 'ready', label: 'Bereit' }
}

/** How close to its length a song must have run for a stop to count as "finished", ms - covers
 * the auto-stop at the end and a band that stops on the last chord a moment early, but not a
 * Reset after a false start. */
export const FINISHED_TOLERANCE_MS = 5000

/** Whether a run that just went from playing to stopped reached the song's end. A song without a
 * known length is never "finished" - the bar simply goes back to "Bereit". */
export function finishedAfterRun(lastElapsedMs: number | null, durationMs: number | null): boolean {
  return lastElapsedMs !== null && durationMs !== null && lastElapsedMs >= durationMs - FINISHED_TOLERANCE_MS
}

/** Full-bar colours per state (Marco: "try the full bar"), each with its own readable text. */
export const STATUS_BAR_CLASS: Record<StatusBarKind, string> = {
  ready: 'bg-surface text-ink',
  'count-in': 'bg-blue-700 text-white',
  playing: 'bg-green-700 text-white',
  paused: 'bg-amber-500 text-black',
  finished: 'bg-fuchsia-700 text-white',
  fault: 'bg-red-600 text-white',
}

/** The count-in flash: the bar lights up on each count-in beat, so the band locks onto the
 * song's tempo before it starts (Marco, 2026-09-27). */
export const COUNT_IN_FLASH_CLASS = 'bg-sky-300 text-black'
/** How long each count-in flash stays lit, ms - clearly visible, still a pulse at fast tempos. */
export const COUNT_IN_FLASH_MS = 120

/** "3:07", "-0:02" during the count-in (the song's own clock runs negative before beat one). */
export function formatSongTime(ms: number): string {
  const negative = ms < 0
  const total = Math.floor(Math.abs(ms) / 1000)
  const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  return negative ? `-${text}` : text
}
