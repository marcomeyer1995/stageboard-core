import { DEFAULT_TRANSITION_DELAY_MS, isTransitionEntry, type SetlistEntry, type TransitionType } from 'shared-types'

/** A song's or a transition item's own choice. */
export function entryTransitionType(entry: SetlistEntry | null): TransitionType {
  return entry?.transitionType ?? 'manual'
}

function entryDelayMs(entry: SetlistEntry | null): number {
  return entry?.transitionDelayMs ?? DEFAULT_TRANSITION_DELAY_MS
}

/** How long a transition item's countdown runs, or null when it has no scheduled end - an item
 * without a duration, or one set to `manual` (then it's only a stopwatch and "Weiter" ends it). Songs end with their backing track instead, so this is null for them. */
export function transitionItemEndMs(entry: SetlistEntry | null): number | null {
  if (!entry || !isTransitionEntry(entry)) return null
  if (entry.estimatedDurationMs === undefined || entryTransitionType(entry) === 'manual') return null
  return entry.estimatedDurationMs
}

export type TrackEndAction =
  | { kind: 'stop' }
  | { kind: 'arm-next' }
  | { kind: 'start-next'; skipCountIn: boolean; delayMs: number }

/** What to do when `entry`'s backing track (or a transition item's countdown) reaches its
 * scheduled end (#232, #29). Anything that needs a next entry falls back to a plain stop when
 * there is none (last entry of the setlist). */
export function resolveTrackEndAction(entry: SetlistEntry | null, nextEntry: SetlistEntry | null): TrackEndAction {
  const type = entryTransitionType(entry)
  if (type === 'manual' || !nextEntry) return { kind: 'stop' }
  if (type === 'next-ready') return { kind: 'arm-next' }
  if (type === 'seamless') return { kind: 'start-next', skipCountIn: true, delayMs: 0 }
  return { kind: 'start-next', skipCountIn: false, delayMs: entryDelayMs(entry) }
}
