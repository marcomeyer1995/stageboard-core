import { DEFAULT_TRANSITION_DELAY_MS, isTransitionEntry, type SetlistEntry, type TransitionType } from 'shared-types'

/** A transition item (#29) has no track, so it never hands off into anything itself. */
export function entryTransitionType(entry: SetlistEntry | null): TransitionType {
  return entry && !isTransitionEntry(entry) ? (entry.transitionType ?? 'manual') : 'manual'
}

export type TrackEndAction =
  | { kind: 'stop' }
  | { kind: 'arm-next' }
  | { kind: 'start-next'; skipCountIn: boolean; delayMs: number }

/** What to do when `entry`'s backing track reaches its scheduled end (#232). Anything that
 * needs a next entry falls back to a plain stop when there is none (last song of the set, or -
 * once #29 exists - a non-song item, which must never receive segued audio). */
export function resolveTrackEndAction(entry: SetlistEntry | null, nextEntry: SetlistEntry | null): TrackEndAction {
  const type = entryTransitionType(entry)
  if (type === 'manual' || !nextEntry) return { kind: 'stop' }
  // A transition item has nothing to auto-play, so segueing into one just arms it (its notes show).
  if (type === 'next-ready' || isTransitionEntry(nextEntry)) return { kind: 'arm-next' }
  if (type === 'seamless') return { kind: 'start-next', skipCountIn: true, delayMs: 0 }
  const delayMs = entry && !isTransitionEntry(entry) ? entry.transitionDelayMs : undefined
  return { kind: 'start-next', skipCountIn: false, delayMs: delayMs ?? DEFAULT_TRANSITION_DELAY_MS }
}
