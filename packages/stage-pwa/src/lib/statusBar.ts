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

/** The word for the state - a key into the `statusbar` texts (state.*), translated where shown (#456). */
export type StatusBarLabel = 'ready' | 'countIn' | 'playing' | 'paused' | 'finished' | 'audioError' | 'syncError' | 'offline' | 'noMaster'

export interface StatusBarState {
  kind: StatusBarKind
  label: StatusBarLabel
}

export interface StatusBarInput {
  mode: SessionMode
  playbackStatus: PlaybackStatus
  /** Playing, but still in the count-in bars before the song's first beat. */
  isCountIn: boolean
  /** Stopped because the track ran out by itself (shared ShowState.trackEnded, #27). */
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
  if (input.audioError) return { kind: 'fault', label: 'audioError' }
  if (input.syncStatus === 'error') return { kind: 'fault', label: 'syncError' }
  if (input.mode === 'gig' && input.syncStatus === 'offline') return { kind: 'fault', label: 'offline' }
  if (input.mode === 'gig' && input.noMaster) return { kind: 'fault', label: 'noMaster' }
  if (input.playbackStatus === 'playing') {
    return input.isCountIn ? { kind: 'count-in', label: 'countIn' } : { kind: 'playing', label: 'playing' }
  }
  if (input.playbackStatus === 'paused') return { kind: 'paused', label: 'paused' }
  return input.finished ? { kind: 'finished', label: 'finished' } : { kind: 'ready', label: 'ready' }
}

/** Full-bar colours per state (Marco: "try the full bar"), each with its own readable text. */
export const STATUS_BAR_CLASS: Record<StatusBarKind, string> = {
  ready: 'bg-surface text-ink',
  'count-in': 'bg-state-count-in text-state-count-in-ink',
  playing: 'bg-state-playing text-state-playing-ink',
  paused: 'bg-state-paused text-state-paused-ink',
  finished: 'bg-state-finished text-state-finished-ink',
  fault: 'bg-state-fault text-state-fault-ink',
}

/** How long the count block stays lit on each count-in beat, ms - clearly visible, still a
 * pulse at fast tempos. Only the count block flashes, not the whole bar: a whole bar flipping
 * dark/light (and its text white/black) on every beat looked wrong on the tablet (Marco,
 * 2026-09-27), and it made the title, time and clock flicker along. */
export const COUNT_IN_FLASH_MS = 120

export interface CountInPosition {
  /** 1-based count-in bar, e.g. 1 of 2. */
  bar: number
  bars: number
  /** 1-based beat in the bar - the number the band counts. */
  beat: number
  beatsPerBar: number
}

/**
 * Where in the count-in a beat falls: which count-in bar, which beat. `firstBeatMs` is the
 * song's first beat (bar 1 of the click grid, else 0) - the count-in is the `countInBars` bars
 * before it. The beat counted is measured from the start of the current beat (`msIntoBeat`
 * back), rounded, so float jitter at a beat edge can't skip or repeat a bar.
 */
export function countInPosition(
  elapsedMs: number,
  msIntoBeat: number,
  effectiveBpm: number,
  firstBeatMs: number,
  countInBars: number,
  beatInBar: number,
  beatsPerBar: number,
): CountInPosition {
  const msPerBeat = 60000 / effectiveBpm
  const total = Math.max(1, countInBars) * beatsPerBar
  const remaining = Math.round((firstBeatMs - (elapsedMs - msIntoBeat)) / msPerBeat)
  const index = Math.min(total - 1, Math.max(0, total - remaining))
  return {
    bar: Math.floor(index / beatsPerBar) + 1,
    bars: Math.max(1, countInBars),
    beat: beatInBar + 1,
    beatsPerBar,
  }
}

/** "3:07"; before beat one (the count-in runs the song clock negative) a countdown "-0:02",
 * "-0:01", "0:00" - rounded up, so it never shows "-0:00". */
export function formatSongTime(ms: number): string {
  const negative = ms < 0
  const abs = Math.abs(ms) / 1000
  const total = negative ? Math.ceil(abs) : Math.floor(abs)
  const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  return negative && total > 0 ? `-${text}` : text
}
