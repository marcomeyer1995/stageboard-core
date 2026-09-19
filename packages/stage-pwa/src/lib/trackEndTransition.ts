import { DEFAULT_TRANSITION_DELAY_MS, type SetlistEntry } from 'shared-types'

export type TrackEndAction =
  | { kind: 'stop' }
  | { kind: 'arm-next' }
  | { kind: 'start-next'; skipCountIn: boolean; delayMs: number }

/** What to do when `entry`'s backing track reaches its scheduled end (#232). Anything that
 * needs a next entry falls back to a plain stop when there is none (last song of the set, or -
 * once #29 exists - a non-song item, which must never receive segued audio). */
export function resolveTrackEndAction(entry: SetlistEntry | null, nextEntry: SetlistEntry | null): TrackEndAction {
  const type = entry?.transitionType ?? 'manual'
  if (type === 'manual' || !nextEntry) return { kind: 'stop' }
  if (type === 'next-ready') return { kind: 'arm-next' }
  if (type === 'seamless') return { kind: 'start-next', skipCountIn: true, delayMs: 0 }
  return { kind: 'start-next', skipCountIn: false, delayMs: entry?.transitionDelayMs ?? DEFAULT_TRANSITION_DELAY_MS }
}
