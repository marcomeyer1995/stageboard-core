import type { OscInMessage } from 'shared-types'
import type { Behavior } from './actions'

/**
 * OSC as a trigger (#484, docs/23 §4): a button of an OSC controller (TouchOSC, a lighting desk, a
 * Stream Deck plugin) is an address - its rule says what pressing it does, the same behaviours as
 * a pedal key or a MIDI controller. The controller sends to the Stage-Server's OSC port; the rules
 * belong to the "OSC-Eingang" device and are band-wide.
 */

export const OSC_INPUT_CAPABILITY = 'osc-input'

export interface OscTrigger {
  address: string
  /** Just this first value counts as the press (a controller sending /scene 1, /scene 2 …).
   * Absent: a first value above 0 (or true, or none at all) presses, 0 (or false) lets go. */
  value?: number
}

export interface OscInputRule {
  id: string
  trigger: OscTrigger
  behavior: Behavior
}

/** One document per OSC-Eingang device, keyed by its LogicalDevice id. */
export interface OscInputRulesDoc {
  id: string
  rules: OscInputRule[]
}

/** Press or let go, from the message's first value - TouchOSC sends 1 on touch and 0 on release. */
export function oscEdge(message: Pick<OscInMessage, 'args'>): 'press' | 'release' {
  const first = message.args[0]
  if (first === undefined || typeof first === 'string') return 'press'
  if (typeof first === 'boolean') return first ? 'press' : 'release'
  return first > 0 ? 'press' : 'release'
}

export function firstNumber(message: Pick<OscInMessage, 'args'>): number | null {
  const first = message.args[0]
  return typeof first === 'number' ? first : null
}

/** The rule a message belongs to, and whether it presses or lets go of it. A rule with its own
 * value only presses on exactly that value and is never let go. */
export function matchOscRule(rules: readonly OscInputRule[], message: Pick<OscInMessage, 'address' | 'args'>): { rule: OscInputRule; edge: 'press' | 'release' } | null {
  for (const rule of rules) {
    if (rule.trigger.address !== message.address) continue
    if (rule.trigger.value !== undefined) {
      if (firstNumber(message) === rule.trigger.value) return { rule, edge: 'press' }
      continue
    }
    return { rule, edge: oscEdge(message) }
  }
  return null
}

/** The trigger a learned message stands for - a first value other than 1 (or 0) is kept, since such
 * controllers tell buttons apart by it. */
export function oscTriggerFrom(message: Pick<OscInMessage, 'address' | 'args'>): OscTrigger {
  const value = firstNumber(message)
  return value !== null && value !== 1 && value !== 0 ? { address: message.address, value } : { address: message.address }
}

export function sameOscTrigger(a: OscTrigger, b: OscTrigger): boolean {
  return a.address === b.address && a.value === b.value
}

/** "/1/push1" or "/scene = 3". */
export function describeOscTrigger(trigger: OscTrigger): string {
  return trigger.value === undefined ? trigger.address : `${trigger.address} = ${trigger.value}`
}
