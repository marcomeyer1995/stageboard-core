import type { ShowCue } from 'shared-types'
import { randomId } from './id'
import type { DecodedEvent, MidiDecoder } from './midiCueDecoders'

/** Consecutive `mg30.setKnob` messages for one knob closer together than this are one gesture. */
const KNOB_GESTURE_GAP_MS = 300

export interface RecordedCue {
  timeMs: number
  event: DecodedEvent
}

export interface CueRecording {
  /** Feed one incoming message with the song position it arrived at. Returns the cue it became
   * (or replaced), or null when it was ignored. */
  handle: (data: readonly number[], songTimeMs: number) => RecordedCue | null
  /** Cues captured so far, oldest first. */
  recorded: () => RecordedCue[]
  /** How many messages the decoder had no event for. */
  ignoredCount: () => number
  /** The captured cues as ShowCues for `targetLogicalDeviceId`, ready to merge into a variant. */
  toShowCues: (targetLogicalDeviceId: string, newId?: () => string) => ShowCue[]
}

function knobKey(event: DecodedEvent): string | null {
  return event.type === 'mg30.setKnob' ? `mg30.setKnob:${String(event.payload?.cc)}` : null
}

/**
 * Collects the cues of one recording pass (#6): every decodable message becomes a cue at the song
 * position it arrived at. A knob turned across the dial sends dozens of CCs a second, so
 * consecutive messages for the same knob collapse into one cue at the end of the gesture with its
 * final value - anything else would drown the cue list.
 */
export function createCueRecording(decoder: MidiDecoder): CueRecording {
  const cues: RecordedCue[] = []
  let ignored = 0
  const lastKnobCue = new Map<string, RecordedCue>()

  return {
    handle(data, songTimeMs) {
      const event = decoder.decode(data)
      if (!event) {
        ignored += 1
        return null
      }
      const timeMs = Math.max(0, Math.round(songTimeMs))
      const key = knobKey(event)
      const previous = key ? lastKnobCue.get(key) : undefined
      if (key && previous && timeMs - previous.timeMs <= KNOB_GESTURE_GAP_MS) {
        previous.timeMs = timeMs
        previous.event = event
        return previous
      }
      const cue: RecordedCue = { timeMs, event }
      cues.push(cue)
      if (key) lastKnobCue.set(key, cue)
      return cue
    },
    recorded: () => cues.map((cue) => ({ ...cue })),
    ignoredCount: () => ignored,
    toShowCues: (targetLogicalDeviceId, newId = randomId) =>
      cues.map((cue) => ({
        id: newId(),
        timeMs: cue.timeMs,
        targetLogicalDeviceId,
        type: cue.event.type,
        payload: cue.event.payload,
      })),
  }
}
