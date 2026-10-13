import type { ShowControlEvent } from 'shared-types'
import { getServerTime } from './clockSync'

/**
 * When a Translator should send an event's MIDI, in the `performance.now()` time base WebMIDI's
 * `send(data, timestamp)` expects - from `scheduledAt` (server time, set by the cue scheduler,
 * #477). Undefined for events without one (a button, a foot switch): those go out at once, as
 * before.
 */
export function midiSendTime(event: Pick<ShowControlEvent, 'scheduledAt'>): number | undefined {
  if (event.scheduledAt === undefined) return undefined
  return performance.now() + (event.scheduledAt - getServerTime())
}
