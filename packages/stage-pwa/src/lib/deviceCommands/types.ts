/**
 * What a device can be told to do from a cue, in the musician's words (docs/14 §7): each device
 * module describes its own commands - the event `type` its translator handles, the payload
 * fields with their ranges, and a short text for the timeline ("Rig 12/3") - so the cue dialog
 * offers a choice instead of free-text JSON. Kept free of MIDI/store imports so the editor can
 * load them without pulling in a device's transport.
 */

export type CommandField =
  | { key: string; label: string; kind: 'int'; min: number; max: number}
  | { key: string; label: string; kind: 'number'; min: number; max: number; step: number; unit?: string}
  | { key: string; label: string; kind: 'choice'; options: { value: string | number; label: string }[]}
  | { key: string; label: string; kind: 'bool'}

export interface DeviceCommand {
  /** The event type the device's translator handles (`kemper.selectRig`). */
  type: string
  /** What the musician reads in the cue dialog ("Rig wählen"). */
  label: string
  fields: CommandField[]
  /** A short text for the cue marker ("Rig 12/3"). */
  describe: (payload: Record<string, unknown>) => string
}
