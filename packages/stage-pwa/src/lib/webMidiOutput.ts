import { isWebMidiSupported } from './webMidi'

let cachedAccess: Promise<MIDIAccess | null> | null = null

function getAccess(): Promise<MIDIAccess | null> {
  if (!isWebMidiSupported()) return Promise.resolve(null)
  // `sysex: true` - without it, an output obtained from this access object throws
  // NotAllowedError on any System Exclusive send (`sendSysEx` below, needed by the NUX MG-30's
  // identity handshake) even after the user has already granted plain MIDI access. Requested
  // unconditionally here (not just for SysEx-capable devices) since sysexEnabled is a property
  // of the MIDIAccess object itself, not something a later, separate request can add on top of
  // this shared cached instance.
  cachedAccess ??= navigator.requestMIDIAccess({ sysex: true }).catch(() => null)
  return cachedAccess
}

/**
 * Resolves a `MIDIOutput` by its `MIDIPort.id` (the same id a `DeviceTransportConfig`'s
 * `values.midiOutputId` stores) - null whenever WebMIDI is unsupported/denied, or the id no
 * longer names a connected output, both normal states (Graceful Degradation) rather than errors.
 */
export async function getMidiOutputById(outputId: string, sendAt?: number): Promise<MIDIOutput | null> {
  const access = await getAccess()
  const output = access?.outputs.get(outputId) ?? null
  return output && sendAt !== undefined ? scheduledOutput(output, sendAt) : output
}

/** The connected MIDI outputs (id and name) - empty when WebMIDI is unsupported or denied. */
export async function listMidiOutputs(): Promise<{ id: string; name: string }[]> {
  const access = await getAccess()
  return access ? [...access.outputs.values()].map((output) => ({ id: output.id, name: output.name ?? output.id })) : []
}

/** Per output, the latest moment (`performance.now()` time base) a message was scheduled for -
 * what `recallScheduledMidi` would have to take back. */
const pendingUntil = new Map<MIDIOutput, number>()

/** Chrome does not keep the order of messages scheduled for the same timestamp (measured
 * 2026-10-13: an NRPN's four CCs arrived in a different order on each run) - so each further
 * message of one scheduled event goes out this much later, which keeps them in order. */
const SEQUENCE_STEP_MS = 0.1

/**
 * The same output, but every `send()` without its own timestamp goes out at `sendAt`
 * (`performance.now()` time base) - WebMIDI delivers it then, independent of the main thread
 * (#477: ~0.05 ms jitter instead of up to a frame). Lets a Translator schedule a cue without each
 * of its send helpers taking a time: it resolves its output once with the event's time
 * (`midiSendTime`) and sends as usual; multi-message sequences (NRPN, preselect + slot) keep their
 * order, SEQUENCE_STEP_MS apart.
 */
function scheduledOutput(output: MIDIOutput, sendAt: number): MIDIOutput {
  let next = sendAt
  return new Proxy(output, {
    get(target, prop) {
      if (prop === 'send') {
        return (data: number[] | Uint8Array, timestamp?: number) => {
          const at = timestamp ?? next
          next = at + SEQUENCE_STEP_MS
          pendingUntil.set(target, Math.max(pendingUntil.get(target) ?? 0, at))
          target.send(data, at)
        }
      }
      const value: unknown = Reflect.get(target, prop, target)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
}

/** `clear()` is in the WebMIDI spec but not in TypeScript's DOM types (nor in Chrome). */
type MidiOutputWithClear = MIDIOutput & { clear?: () => void }

/**
 * Takes back every MIDI message still scheduled for the future (Pause/Stop/seek right after a cue
 * was handed over). Only possible where `MIDIOutput.clear()` exists - Chrome 154 has none (#477) -
 * so returns whether everything pending was really cleared; false means some still go out.
 */
export function recallScheduledMidi(now = performance.now()): boolean {
  let allCleared = true
  for (const [output, until] of pendingUntil) {
    if (until <= now) {
      pendingUntil.delete(output)
    } else if (typeof (output as MidiOutputWithClear).clear === 'function') {
      ;(output as MidiOutputWithClear).clear?.()
      pendingUntil.delete(output)
    } else {
      allCleared = false
    }
  }
  return allCleared
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
 * Sends a standard 4-controller NRPN "set" (CC99/98 address MSB/LSB, then CC6/38 data MSB/LSB) -
 * the addressing scheme mixing consoles like the Allen & Heath CQ-18T use for everything
 * (channel mute/level/pan), not a plain single CC. `channel` is 0-indexed. Plain sequential CC
 * messages, not a single SysEx blob - matches exactly what the real console/emulator expects
 * (`cq18t_emulator/nrpn.py`'s own doc comments), and lets `sendControlChange` do the actual byte
 * packing so there's only one place that clamps/masks CC values.
 */
export function sendNrpn(
  output: MIDIOutput,
  channel: number,
  addressMsb: number,
  addressLsb: number,
  dataMsb: number,
  dataLsb: number,
): void {
  sendControlChange(output, channel, 99, addressMsb)
  sendControlChange(output, channel, 98, addressLsb)
  sendControlChange(output, channel, 6, dataMsb)
  sendControlChange(output, channel, 38, dataLsb)
}

/**
 * Sends a raw SysEx message - `bytes` is the payload between `F0`/`F7` (both added here, not
 * included in `bytes`). Used by device-specific plugins whose protocol goes beyond plain CC (the
 * NUX MG-30's identity handshake, `F0 43 58 00 F7`). WebMIDI's `MIDIOutput.send` already accepts
 * an arbitrary byte array - this just documents the framing convention so callers don't each
 * re-derive it.
 */
export function sendSysEx(output: MIDIOutput, bytes: number[]): void {
  output.send([0xf0, ...bytes, 0xf7])
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
