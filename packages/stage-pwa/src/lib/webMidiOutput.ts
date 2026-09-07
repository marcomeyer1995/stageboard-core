import { isWebMidiSupported } from './webMidi'

let cachedAccess: Promise<MIDIAccess | null> | null = null

function getAccess(): Promise<MIDIAccess | null> {
  if (!isWebMidiSupported()) return Promise.resolve(null)
  cachedAccess ??= navigator.requestMIDIAccess().catch(() => null)
  return cachedAccess
}

/**
 * Resolves a `MIDIOutput` by its `MIDIPort.id` (the same id a `DeviceTransportConfig`'s
 * `values.midiOutputId` stores) - null whenever WebMIDI is unsupported/denied, or the id no
 * longer names a connected output, both normal states (Graceful Degradation) rather than errors.
 */
export async function getMidiOutputById(outputId: string): Promise<MIDIOutput | null> {
  const access = await getAccess()
  return access?.outputs.get(outputId) ?? null
}

/**
 * Finds a connected `MIDIOutput` whose name/manufacturer contains `namePattern` (case-
 * insensitive) - a real MIDI device exposes its input and output as two *separate* system ports
 * with independently-generated ids and, per real-world testing against a virtual MIDI rig,
 * asymmetric names (e.g. ALSA/rtmidi labels one side "RtMidiIn Client:X" and the other
 * "RtMidiOut Client:X"). #106's hardware-detection flow only ever observes `access.inputs` (it's
 * built to notice "a device connected", not to send anything), so the port id it captures and
 * writes into a DeviceTransportConfig's `values.midiOutputId` is an *input* port id - useless for
 * `getMidiOutputById` above, which needs an *output* port id. This resolves the real output side
 * directly by name instead, reusing the plugin's own `hardwareIds` namePattern
 * (useHardwareDetection.ts's `bind()`) rather than trying to correlate two asymmetric ids.
 */
export async function findMidiOutputIdByNamePattern(namePattern: string): Promise<string | null> {
  const access = await getAccess()
  if (!access) return null
  const needle = namePattern.toLowerCase()
  for (const output of access.outputs.values()) {
    if ((output.name ?? '').toLowerCase().includes(needle) || (output.manufacturer ?? '').toLowerCase().includes(needle)) {
      return output.id
    }
  }
  return null
}

/** Sends a plain Control Change message - `channel` is 0-indexed (0 = MIDI channel 1). */
export function sendControlChange(output: MIDIOutput, channel: number, cc: number, value: number): void {
  output.send([0xb0 | (channel & 0x0f), cc & 0x7f, value & 0x7f])
}
