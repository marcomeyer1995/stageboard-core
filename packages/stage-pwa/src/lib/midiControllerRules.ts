import type { Behavior } from './actions'

/**
 * MIDI controllers as triggers (#547 step 2, docs/23 §4/§7): a button of a MIDI controller is a
 * Note, a Control Change or a Program Change on a channel - its rule says what pressing it does
 * (the same behaviours as a pedal key). The rules belong to the controller device and are
 * band-wide; the tablet it is plugged into listens.
 */

export type MidiMessageKind = 'note' | 'cc' | 'program'

export interface MidiTrigger {
  message: MidiMessageKind
  /** 1-16, as printed on the gear. */
  channel: number
  /** Note, controller or program number, 0-127. */
  number: number
  /** CC only: just this value counts as the press (a controller sending CC 80 = 127 for one
   * button and CC 80 = 0 for another). Absent: any value above 0 presses, 0 lets go. */
  value?: number
}

export interface MidiControllerRule {
  id: string
  trigger: MidiTrigger
  behavior: Behavior
}

/** One document per controller device, keyed by its LogicalDevice id. */
export interface MidiControllerRulesDoc {
  id: string
  rules: MidiControllerRule[]
}

/** A decoded incoming message: which button, and whether it went down or up. */
export interface MidiButtonEvent {
  message: MidiMessageKind
  channel: number
  number: number
  value: number
  edge: 'press' | 'release'
}

/** Note on/off, CC and Program Change from raw MIDI bytes; everything else (clock, aftertouch,
 * SysEx …) is no button. Note On with velocity 0 is a release, as most gear sends it. */
export function decodeMidiButton(data: readonly number[]): MidiButtonEvent | null {
  const status = data[0] ?? 0
  const command = status & 0xf0
  const channel = (status & 0x0f) + 1
  const number = data[1] ?? 0
  const value = data[2] ?? 0
  if (command === 0x90) return { message: 'note', channel, number, value, edge: value > 0 ? 'press' : 'release' }
  if (command === 0x80) return { message: 'note', channel, number, value: 0, edge: 'release' }
  if (command === 0xb0) return { message: 'cc', channel, number, value, edge: value > 0 ? 'press' : 'release' }
  if (command === 0xc0) return { message: 'program', channel, number, value: 0, edge: 'press' }
  return null
}

/** The rule a decoded message belongs to, and whether it presses or lets go of it. A CC rule
 * with its own value only presses on exactly that value and is never let go. */
export function matchMidiRule(rules: readonly MidiControllerRule[], event: MidiButtonEvent): { rule: MidiControllerRule; edge: 'press' | 'release' } | null {
  for (const rule of rules) {
    const { trigger } = rule
    if (trigger.message !== event.message || trigger.channel !== event.channel || trigger.number !== event.number) continue
    if (trigger.message === 'cc' && trigger.value !== undefined) {
      if (event.value === trigger.value) return { rule, edge: 'press' }
      continue
    }
    return { rule, edge: event.edge }
  }
  return null
}

/** The trigger a learned message stands for - a CC press with a value other than 127 keeps its
 * value, since such controllers tell buttons apart by it. */
export function triggerFromEvent(event: MidiButtonEvent): MidiTrigger {
  const trigger: MidiTrigger = { message: event.message, channel: event.channel, number: event.number }
  return event.message === 'cc' && event.value !== 127 ? { ...trigger, value: event.value } : trigger
}

const KIND_LABEL: Record<MidiMessageKind, string> = { note: 'Note', cc: 'CC', program: 'Program' }

export function describeMidiTrigger(trigger: MidiTrigger): string {
  const value = trigger.message === 'cc' && trigger.value !== undefined ? ` = ${trigger.value}` : ''
  return `${KIND_LABEL[trigger.message]} ${trigger.number}${value} · Kanal ${trigger.channel}`
}

export function sameMidiTrigger(a: MidiTrigger, b: MidiTrigger): boolean {
  return a.message === b.message && a.channel === b.channel && a.number === b.number && a.value === b.value
}
