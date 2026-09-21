import {
  KEMPER_CAPABILITY,
  KEMPER_CC,
  KEMPER_STOMP_CC,
  KEMPER_STOMP_CC_WITH_TAIL,
  MG30_CAPABILITY,
  MG30_KNOB_CC_RANGE,
  RC500_CAPABILITY,
} from './midiDeviceProtocols'

/** A plugin event as a cue stores it (ShowCue's `type` + `payload`). */
export interface DecodedEvent {
  type: string
  payload?: Record<string, unknown>
}

/**
 * Turns the raw MIDI a device sends into the plugin event that would make its translator send the
 * same thing back - the inverse of kemperTranslator.ts/rc500Translator.ts/mg30Translator.ts, so a
 * recorded cue replays through the existing translator unchanged and reads as 'Kemper Rig 3'
 * rather than hex. Returns null for anything the device's translator has no event for (realtime
 * bytes, an unmapped CC, another channel), which the recorder counts as ignored.
 *
 * May keep state between messages (the Kemper selects a rig with two messages: performance, then
 * slot), so one decoder belongs to one recording.
 */
export interface MidiDecoder {
  decode: (data: readonly number[]) => DecodedEvent | null
}

const STATUS_CONTROL_CHANGE = 0xb0
const STATUS_PROGRAM_CHANGE = 0xc0
/** A CC value at/above this counts as "pressed" - the translators only ever send 127 (or 0 to release). */
const PRESSED_THRESHOLD = 64

interface ParsedMessage {
  command: number
  channel: number
  data1: number
  data2: number
}

function parse(data: readonly number[], channel: number | null): ParsedMessage | null {
  const status = data[0]
  // System messages (0xF0+: clock, active sensing, SysEx) are never cues.
  if (status === undefined || status < 0x80 || status >= 0xf0) return null
  const parsed = { command: status & 0xf0, channel: status & 0x0f, data1: data[1] ?? 0, data2: data[2] ?? 0 }
  return channel !== null && parsed.channel !== channel ? null : parsed
}

function kemperDecoder(channel: number | null): MidiDecoder {
  let pendingPerformance: number | null = null
  return {
    decode(data) {
      const message = parse(data, channel)
      if (!message || message.command !== STATUS_CONTROL_CHANGE) return null
      const { data1: cc, data2: value } = message

      if (cc === KEMPER_CC.performancePreselect) {
        // Half of a rig change - remembered until the slot arrives, never a cue on its own.
        pendingPerformance = value
        return null
      }
      const slotIndex = KEMPER_CC.slot.findIndex((slotCc) => slotCc === cc)
      if (slotIndex !== -1) {
        // Without a preceding performance there is no complete `kemper.selectRig` to record.
        if (value < PRESSED_THRESHOLD || pendingPerformance === null) return null
        return { type: 'kemper.selectRig', payload: { performance: pendingPerformance, slot: slotIndex + 1 } }
      }
      if (value < PRESSED_THRESHOLD) return null
      const tail = Object.entries(KEMPER_STOMP_CC_WITH_TAIL).find(([, stompCc]) => stompCc === cc)
      if (tail) return { type: 'kemper.stomp', payload: { stomp: tail[0], tail: true } }
      const stomp = Object.entries(KEMPER_STOMP_CC).find(([, stompCc]) => stompCc === cc)
      return stomp ? { type: 'kemper.stomp', payload: { stomp: stomp[0] } } : null
    },
  }
}

function rc500Decoder(channel: number | null): MidiDecoder {
  return {
    decode(data) {
      const message = parse(data, channel)
      // The RC-500 only exposes its 99 memories over Program Change (wire value = memory - 1).
      if (!message || message.command !== STATUS_PROGRAM_CHANGE || message.data1 > 98) return null
      return { type: 'rc500.selectMemory', payload: { memory: message.data1 + 1 } }
    },
  }
}

function mg30Decoder(channel: number | null): MidiDecoder {
  return {
    decode(data) {
      const message = parse(data, channel)
      if (!message) return null
      if (message.command === STATUS_PROGRAM_CHANGE) return { type: 'mg30.selectPatch', payload: { program: message.data1 } }
      if (message.command === STATUS_CONTROL_CHANGE && message.data1 >= MG30_KNOB_CC_RANGE.min && message.data1 <= MG30_KNOB_CC_RANGE.max) {
        return { type: 'mg30.setKnob', payload: { cc: message.data1, value: message.data2 } }
      }
      return null
    },
  }
}

const DECODER_FACTORIES: Record<string, (channel: number | null) => MidiDecoder> = {
  [KEMPER_CAPABILITY]: kemperDecoder,
  [RC500_CAPABILITY]: rc500Decoder,
  [MG30_CAPABILITY]: mg30Decoder,
}

/** Whether a Logical Device of this capability can be recorded from. (The CQ-18T's NRPN and the
 * Ui24R's WebSocket traffic have no simple message-to-event mapping, so they are not offered.) */
export function canDecodeCapability(capability: string): boolean {
  return capability in DECODER_FACTORIES
}

/** A decoder for `capability`, or null. `channel` is the device's 0-indexed MIDI channel; null
 * accepts every channel (no channel configured). */
export function createMidiDecoder(capability: string, channel: number | null): MidiDecoder | null {
  return DECODER_FACTORIES[capability]?.(channel) ?? null
}
