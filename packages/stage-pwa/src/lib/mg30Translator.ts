import type { ShowControlResult } from 'shared-types'
import { getDeviceId } from './deviceId'
import type { Translator } from './clientTranslator'
import { isWebMidiSupported } from './webMidi'
import { getMidiOutputById, sendSysEx } from './webMidiOutput'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

/**
 * A real, installable plugin (pluginCatalog.ts) rather than a mock - own dedicated capability,
 * not one of `capability.ts`'s core `CAPABILITIES` (a multi-effects unit's patch/knob vocabulary
 * doesn't fit any of them) - same reasoning kemperTranslator.ts's `KEMPER_CAPABILITY` and
 * cq18tTranslator.ts's `CQ18T_CAPABILITY` already document.
 */
export const MG30_CAPABILITY = 'mg30-control'

/** `43 58` device-signature prefix (not a registered MIDI Manufacturer ID) every NUX MG-30
 * SysEx message starts with - reverse-engineered from `mg30-controller`, hardware-verified on
 * firmware v4.0.3, transcribed from
 * `~/Device Emulators/NUX MG30 Emulator/nux_mg30_emulator/sysex.py`/`docs/protocol-notes.md`. */
const DEVICE_SIGNATURE = [0x43, 0x58]
const FN_IDENTITY_REQUEST = 0x00
const FN_IDENTITY_RESPONSE = 0x10

/** Continuous knob CCs 11-74 (per-block ranges, `nux_mg30_emulator/cc_map.py`'s `KNOB_CC_NAMES`) -
 * only the block-start CC is named here; a caller picks the exact CC within a block's documented
 * range itself (`mg30.setKnob`'s `cc` payload field is the raw CC number, not a symbolic name) -
 * same "expose the real protocol, don't invent an abstraction on top of it" choice
 * cq18tTranslator.ts's NRPN addressing already makes. Block bypass/model-select CCs (0-10) are
 * deliberately not exposed here: their value isn't plain on/off but a per-model save-code
 * (`effects.find_model_by_cc_value`) with no complete, verified table available - sending a
 * guessed value risks putting the unit in an unintended state, worse than not offering the
 * action at all.
 */
const KNOB_CC_RANGE = { min: 11, max: 74 }

interface Mg30Output {
  output: MIDIOutput
  channel: number // 0-indexed
}

/** Same "first Logical Device with this capability, bound on this device" resolution as
 * kemperTranslator.ts/cq18tTranslator.ts - see their own doc comments for why. */
async function resolveMg30Output(): Promise<Mg30Output | null> {
  const logicalDevice = useLogicalDevicesStore.getState().devices.find((d) => d.capability === MG30_CAPABILITY)
  if (!logicalDevice) return null

  const deviceId = getDeviceId()
  const config = useDeviceTransportConfigStore
    .getState()
    .configs.find((c) => c.deviceId === deviceId && c.logicalDeviceId === logicalDevice.id)
  const outputId = config?.values.midiOutputId
  if (!outputId) return null

  const output = await getMidiOutputById(outputId)
  if (!output) return null

  const channel = Number(config?.values.midiChannel)
  return { output, channel: (Number.isInteger(channel) && channel >= 1 && channel <= 16 ? channel : 1) - 1 }
}

function selectPatch(mg30: Mg30Output, payload: Record<string, unknown> | undefined): ShowControlResult {
  const program = Number(payload?.program)
  if (!Number.isInteger(program) || program < 0 || program > 127) {
    return { status: 'error', message: 'mg30.selectPatch: program muss 0-127 sein.' }
  }
  mg30.output.send([0xc0 | (mg30.channel & 0x0f), program])
  const bank = Math.floor(program / 4) + 1
  const letter = 'ABCD'[program % 4]
  return { status: 'ok', data: { program, patchName: `${String(bank).padStart(2, '0')}${letter}` } }
}

function setKnob(mg30: Mg30Output, payload: Record<string, unknown> | undefined): ShowControlResult {
  const cc = Number(payload?.cc)
  const value = Number(payload?.value)
  if (!Number.isInteger(cc) || cc < KNOB_CC_RANGE.min || cc > KNOB_CC_RANGE.max) {
    return { status: 'error', message: `mg30.setKnob: cc muss ${KNOB_CC_RANGE.min}-${KNOB_CC_RANGE.max} sein.` }
  }
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    return { status: 'error', message: 'mg30.setKnob: value muss 0-127 sein.' }
  }
  mg30.output.send([0xb0 | (mg30.channel & 0x0f), cc, value])
  return { status: 'ok', data: { cc, value } }
}

/**
 * Finds the real MIDIInput matching `namePattern` and waits (up to `timeoutMs`) for a SysEx
 * reply whose first bytes equal `expectedPrefix` - the receive half of the identity handshake
 * `test` below needs, which (unlike cq18tTranslator.ts's fire-only Get) has a genuinely
 * meaningful decodable reply worth actually reading. Kept local to this file rather than added
 * to webMidi.ts's shared surface - a single-use request/reply primitive, not a general one yet.
 */
async function waitForSysExReply(namePattern: string, expectedPrefix: number[], timeoutMs: number): Promise<Uint8Array | null> {
  if (!isWebMidiSupported()) return null
  let access: MIDIAccess
  try {
    // `sysex: true` - without it, incoming System Exclusive messages are silently dropped
    // before reaching `midimessage` listeners, same reasoning webMidiOutput.ts's `getAccess`
    // now documents for the send side.
    access = await navigator.requestMIDIAccess({ sysex: true })
  } catch {
    return null
  }
  const needle = namePattern.toLowerCase()
  const input = Array.from(access.inputs.values()).find(
    (candidate) => (candidate.name ?? '').toLowerCase().includes(needle) || (candidate.manufacturer ?? '').toLowerCase().includes(needle),
  )
  if (!input) return null
  const midiInput: MIDIInput = input

  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      midiInput.removeEventListener('midimessage', handler)
      resolve(null)
    }, timeoutMs)
    function handler(event: MIDIMessageEvent) {
      const data = event.data
      if (!data || settled) return
      if (expectedPrefix.every((byte, i) => data[i] === byte)) {
        settled = true
        clearTimeout(timer)
        midiInput.removeEventListener('midimessage', handler)
        resolve(data)
      }
    }
    midiInput.addEventListener('midimessage', handler)
  })
}

/** Sends the identity request (`F0 43 58 00 F7`) and waits for the real reply (`F0 43 58 10
 * <6-byte ASCII firmware version> ...zero-padded... F7`) - a genuine round-trip proving the
 * connection is alive, entirely read-only (no patch/effect state ever changes), same safety
 * bar cq18tTranslator.ts's read-only Get test sets for a device whose "test" a user could click
 * at any time. */
async function test(mg30: Mg30Output): Promise<ShowControlResult> {
  sendSysEx(mg30.output, [...DEVICE_SIGNATURE, FN_IDENTITY_REQUEST])
  const reply = await waitForSysExReply('MG-30', [0xf0, ...DEVICE_SIGNATURE, FN_IDENTITY_RESPONSE], 1000)
  if (!reply) return { status: 'error', message: 'MG-30: keine Antwort auf die Identitätsabfrage.' }
  const versionBytes = Array.from(reply.slice(4, 10)).filter((byte) => byte !== 0)
  const version = String.fromCharCode(...versionBytes)
  return { status: 'ok', message: `Firmware ${version}` }
}

export const mg30Translator: Translator = async (event) => {
  if (!isWebMidiSupported()) return { status: 'error', message: 'MG-30: WebMIDI nicht unterstützt.' }
  const mg30 = await resolveMg30Output()
  if (!mg30) return { status: 'error', message: 'MG-30: kein MIDI-Ausgang konfiguriert.' }

  switch (event.type) {
    case 'mg30.selectPatch':
      return selectPatch(mg30, event.payload)
    case 'mg30.setKnob':
      return setKnob(mg30, event.payload)
    case 'test':
      return test(mg30)
    default:
      return { status: 'error', message: `MG-30: unbekannter Event-Typ "${event.type}".` }
  }
}
