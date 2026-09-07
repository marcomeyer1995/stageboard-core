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

/**
 * Sends a full CC sequence (e.g. a plugin's `discoveryTrigger.matchCcSequence`) to the real
 * output matching `namePattern` - the Discovery Wizard's "Jetzt senden" button, for verifying a
 * role's trigger reaches the real device without a musician having to physically touch it.
 * Deliberately the *only* thing this does: it does not itself resolve or wait for the resulting
 * `discovery/triggered` report - that round trip already works (useDiscoveryTrigger.ts listens
 * on this exact device's own input independently), this just needs to actually put the signal on
 * the wire. Returns false (not a throw) when no matching output exists, same Graceful
 * Degradation spirit as the rest of this module - a wizard button that does nothing on a device
 * with no MIDI output is a normal state, not an error.
 */
export async function sendCcSequence(
  namePattern: string,
  sequence: { cc: number; value: number }[],
  channel = 0,
): Promise<boolean> {
  const outputId = await findMidiOutputIdByNamePattern(namePattern)
  const output = outputId ? await getMidiOutputById(outputId) : null
  if (!output) return false
  for (const step of sequence) {
    sendControlChange(output, channel, step.cc, step.value)
    // A brief gap between steps - an instant on/off pair risks being coalesced or misread by
    // whatever's matching the sequence on the receiving end (real hardware and
    // useDiscoveryTrigger.ts's own matcher both read messages one at a time).
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  return true
}
