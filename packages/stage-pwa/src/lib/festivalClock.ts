import {
  DEFAULT_PAUSE_BETWEEN_SONGS_MS,
  DEFAULT_SONG_DURATION_MS,
  isTransitionEntry,
  type Setlist,
} from 'shared-types'
import type { QueueItem } from './computeQueue'
import { countInDurationMs, songDurationMs } from './entryDuration'

export interface FestivalClockInput {
  items: QueueItem[]
  currentEntryId: string | null
  playbackStatus: 'stopped' | 'playing' | 'paused'
  /** Position in the current entry; null / negative (count-in) counts as not started. */
  elapsedMs: number | null
  now: number
  /** Extends the current entry's end (#231's bar-extend). */
  clickExtendMs?: number
  /** Tonight-only track swap for the *current* entry (it resets on advancing). */
  trackOverrideId?: string | null
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
function entryDurationMs(
  item: QueueItem,
  isCurrent: boolean,
  trackOverrideId: string | null,
  defaultSongMs: number,
  defaultPauseMs: number,
): { ms: number; estimated: boolean } {
  if (isTransitionEntry(item.entry)) {
    return { ms: item.entry.estimatedDurationMs ?? defaultPauseMs, estimated: false }
  }
  const known = songDurationMs(item.entry, item.variant, isCurrent ? trackOverrideId : null)
  return known ? { ms: known.ms, estimated: false } : { ms: defaultSongMs, estimated: true }
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
    const isCurrent = i === startIndex
    const { ms, estimated } = entryDurationMs(item, isCurrent, input.trackOverrideId ?? null, defaultSongMs, defaultPauseMs)
    if (estimated) estimatedSongs += 1
    // Running (or paused) already: what is left of it, counting from its own position 0 - a
    // negative position during the count-in adds the count-in time still to come. Otherwise it
    // starts fresh: its count-in first, unless the previous entry hands over seamlessly.
    const running = isCurrent && playbackStatus !== 'stopped' && elapsedMs !== null
    if (running) {
      remainingMs += Math.max(0, ms + (input.clickExtendMs ?? 0) - (elapsedMs ?? 0))
    } else {
      const previous = i > startIndex ? items[i - 1] : undefined
      const seamlessIn = previous !== undefined && (previous.entry.transitionType ?? 'manual') === 'seamless'
      remainingMs += ms + (seamlessIn || isTransitionEntry(item.entry) ? 0 : countInDurationMs(item.variant))
    }
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
