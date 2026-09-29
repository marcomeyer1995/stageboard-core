import { CAPABILITIES, type CapabilityId, type ShowCue } from 'shared-types'
import { KEMPER_CAPABILITY, MG30_CAPABILITY, RC500_CAPABILITY } from '../midiDeviceProtocols'
import { KEMPER_COMMANDS } from './kemper'
import { MG30_COMMANDS, RC500_COMMANDS } from './midiPedals'
import { CQ18T_COMMANDS, UI24R_COMMANDS } from './mixers'
import type { CommandField, DeviceCommand } from './types'

export type { CommandField, DeviceCommand } from './types'

/** The click's own command (clientTranslator.ts's `click.extend`). */
const CLICK_COMMANDS: DeviceCommand[] = [
  {
    type: 'click.extend',
    label: 'Klick verlängern',
    fields: [{ key: 'bars', label: 'Takte', kind: 'int', min: 1, max: 64 }],
    describe: (p) => `+${String(p.bars)} Takte`,
  },
]

/** Capability → its commands, the same keys as clientTranslator.ts's translator registry. The
 * CQ-18T/Ui24R capability strings are spelled out here so this module stays free of their
 * translators' transport imports. */
const COMMANDS: Record<string, DeviceCommand[]> = {
  [KEMPER_CAPABILITY]: KEMPER_COMMANDS,
  [RC500_CAPABILITY]: RC500_COMMANDS,
  [MG30_CAPABILITY]: MG30_COMMANDS,
  'cq18t-control': CQ18T_COMMANDS,
  'ui24r-control': UI24R_COMMANDS,
  [CAPABILITIES.clickTrack]: CLICK_COMMANDS,
}

/** The commands a device of this capability understands - empty when none are described (the
 * cue dialog then falls back to free-text type and payload). */
export function commandsFor(capability: CapabilityId): DeviceCommand[] {
  return COMMANDS[capability] ?? []
}

/** A cue in words for its marker: the command's description, else its raw type. */
export function describeCue(cue: Pick<ShowCue, 'type' | 'payload'>, capability: CapabilityId | undefined): string {
  const command = capability ? commandsFor(capability).find((c) => c.type === cue.type) : undefined
  return command ? command.describe(cue.payload ?? {}) : cue.type
}

/** The dropdown entries for a field: every whole number of its range, the dB steps, the choices,
 * or yes/no - each as the string the dropdown carries plus what it shows. */
export function fieldOptions(field: CommandField): { value: string; label: string }[] {
  switch (field.kind) {
    case 'int':
      return Array.from({ length: field.max - field.min + 1 }, (_, i) => ({ value: String(field.min + i), label: String(field.min + i) }))
    case 'number': {
      const count = Math.floor((field.max - field.min) / field.step) + 1
      return Array.from({ length: count }, (_, i) => {
        const v = Math.round((field.min + i * field.step) * 100) / 100
        return { value: String(v), label: field.unit ? `${v} ${field.unit}` : String(v) }
      })
    }
    case 'choice':
      return field.options.map((o) => ({ value: String(o.value), label: o.label }))
    case 'bool':
      return [
        { value: 'true', label: 'Ja' },
        { value: 'false', label: 'Nein' },
      ]
  }
}

/**
 * The payload from the dialog's text answers - numbers parsed (a comma is a decimal point) and
 * range-checked, choices mapped back to their typed value, yes/no to a boolean. An error message
 * names the field when an answer doesn't fit.
 */
export function payloadFromAnswers(fields: readonly CommandField[], answers: Record<string, string>): { payload: Record<string, unknown> } | { error: string } {
  const payload: Record<string, unknown> = {}
  for (const field of fields) {
    const raw = (answers[field.key] ?? '').trim()
    switch (field.kind) {
      case 'int': {
        const n = Number(raw)
        if (!raw || !Number.isInteger(n) || n < field.min || n > field.max) return { error: `${field.label}: ganze Zahl von ${field.min} bis ${field.max}.` }
        payload[field.key] = n
        break
      }
      case 'number': {
        const n = Number(raw.replace(',', '.'))
        if (!raw || !Number.isFinite(n)) return { error: `${field.label}: eine Zahl${field.unit ? ` in ${field.unit}` : ''}.` }
        payload[field.key] = n
        break
      }
      case 'choice': {
        const option = field.options.find((o) => String(o.value) === raw)
        if (!option) return { error: `${field.label}: bitte auswählen.` }
        payload[field.key] = option.value
        break
      }
      case 'bool':
        payload[field.key] = raw === 'true'
        break
    }
  }
  return { payload }
}
