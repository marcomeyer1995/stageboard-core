import {
  DEFAULT_PAUSE_BETWEEN_SONGS_MS,
  DEFAULT_SONG_DURATION_MS,
  isTransitionEntry,
  type Setlist,
} from 'shared-types'
import { resolveTrackForEntry, type QueueItem } from './computeQueue'

export interface FestivalClockInput {
  items: QueueItem[]
  currentEntryId: string | null
  playbackStatus: 'stopped' | 'playing' | 'paused'
  /** Position in the current entry; null / negative (count-in) counts as not started. */
  elapsedMs: number | null
  now: number
  /** Extends the current entry's end (#231's bar-extend). */
  clickExtendMs?: number
  setlist: Pick<Setlist, 'targetEndTime' | 'defaultTransitionMs' | 'defaultSongDurationMs'> | null
}

export interface FestivalClockResult {
  /** Wall-clock time the set is predicted to end if the next song starts at once. */
  predictedEnd: number
  remainingMs: number
  /** Null when the setlist has no target end time. */
  targetEnd: number | null
  /** Positive = over the target; null without a target. */
  overrunMs: number | null
  /** How many remaining songs had no measured length and use the default song length. */
  estimatedSongs: number
}

/**
 * Turns "HH:mm" into the next such wall-clock time: today's, unless that already passed by more
 * than 12 hours (a set running past midnight towards 00:30 is meant for the coming night).
 */
export function resolveTargetEnd(now: number, targetEndTime: string): number {
  const [hours, minutes] = targetEndTime.split(':').map(Number)
  const candidate = new Date(now)
  candidate.setHours(hours ?? 0, minutes ?? 0, 0, 0)
  const ms = candidate.getTime()
  return ms < now - 12 * 60 * 60 * 1000 ? ms + 24 * 60 * 60 * 1000 : ms
}

/** Length of one queue position, and whether it had to be estimated. */
function entryDurationMs(item: QueueItem, defaultSongMs: number, defaultPauseMs: number): { ms: number; estimated: boolean } {
  if (isTransitionEntry(item.entry)) {
    return { ms: item.entry.estimatedDurationMs ?? defaultPauseMs, estimated: false }
  }
  const track = resolveTrackForEntry(item.entry, item.variant, null)
  return track?.durationMs !== undefined
    ? { ms: track.durationMs, estimated: false }
    : { ms: defaultSongMs, estimated: true }
}

/**
 * Dead air after `item` before the next entry starts. A transition item is itself the pause, so a
 * song followed by one adds none; `seamless` adds none; `delayed` adds its own delay; anything
 * else (manual / next-ready) adds the setlist's default pause between songs.
 */
function gapAfterMs(item: QueueItem, next: QueueItem, defaultPauseMs: number): number {
  if (isTransitionEntry(next.entry)) return 0
  const type = item.entry.transitionType ?? 'manual'
  if (type === 'seamless') return 0
  if (type === 'delayed') return item.entry.transitionDelayMs ?? defaultPauseMs
  return isTransitionEntry(item.entry) ? 0 : defaultPauseMs
}

/** Festival Clock (#28): when will the rest of the setlist end, and does that beat the curfew? */
export function computeFestivalClock(input: FestivalClockInput): FestivalClockResult {
  const { items, playbackStatus, elapsedMs, now, setlist } = input
  const defaultPauseMs = setlist?.defaultTransitionMs ?? DEFAULT_PAUSE_BETWEEN_SONGS_MS
  const defaultSongMs = setlist?.defaultSongDurationMs ?? DEFAULT_SONG_DURATION_MS
  const found = items.findIndex((item) => item.entry.id === input.currentEntryId)
  const startIndex = Math.max(0, found)

  let remainingMs = 0
  let estimatedSongs = 0
  for (let i = startIndex; i < items.length; i += 1) {
    const item = items[i]!
    const { ms, estimated } = entryDurationMs(item, defaultSongMs, defaultPauseMs)
    if (estimated) estimatedSongs += 1
    const isCurrent = i === startIndex
    const started = isCurrent && playbackStatus !== 'stopped' && (elapsedMs ?? 0) > 0
    remainingMs += started ? Math.max(0, ms + (input.clickExtendMs ?? 0) - (elapsedMs ?? 0)) : ms
    const next = items[i + 1]
    if (next) remainingMs += gapAfterMs(item, next, defaultPauseMs)
  }

  const targetEnd = setlist?.targetEndTime ? resolveTargetEnd(now, setlist.targetEndTime) : null
  const predictedEnd = now + remainingMs
  return {
    predictedEnd,
    remainingMs,
    targetEnd,
    overrunMs: targetEnd === null ? null : predictedEnd - targetEnd,
    estimatedSongs,
  }
}
