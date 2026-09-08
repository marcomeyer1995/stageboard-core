import type { ShowControlResult } from 'shared-types'
import { getDeviceId } from './deviceId'
import type { Translator } from './clientTranslator'
import { getMidiOutputById } from './webMidiOutput'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

/**
 * A real, installable plugin (pluginCatalog.ts) rather than a mock - own dedicated capability,
 * not one of `capability.ts`'s core `CAPABILITIES` (a looper's memory/track vocabulary doesn't
 * fit any of them) - same reasoning kemperTranslator.ts's `KEMPER_CAPABILITY` documents.
 */
export const RC500_CAPABILITY = 'rc500-control'

interface Rc500Output {
  output: MIDIOutput
  channel: number // 0-indexed
}

/** Same "first Logical Device with this capability, bound on this device" resolution as
 * kemperTranslator.ts/cq18tTranslator.ts/mg30Translator.ts - see their own doc comments for
 * why. */
async function resolveRc500Output(): Promise<Rc500Output | null> {
  const logicalDevice = useLogicalDevicesStore.getState().devices.find((d) => d.capability === RC500_CAPABILITY)
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

/**
 * Selects one of the RC-500's 99 memories via Program Change - its only control surface for
 * this beyond the per-memory, user-configured ASSIGN table (docs/protocol-notes.md, reproduced
 * from the Owner's Manual p.20-21: "Program Change messages numbered 1 through 99, corresponding
 * to the 99 individual memories 1-99", wire value = memory - 1). Control Change is deliberately
 * not exposed as a generic action here: unlike Kemper/CQ-18T/NUX, the RC-500 has no fixed global
 * CC table - every CC's meaning is per-memory and configured on the device itself, so this
 * plugin has no way to know what a given CC number would actually do on whatever memory happens
 * to be loaded when a cue fires.
 */
function selectMemory(rc500: Rc500Output, payload: Record<string, unknown> | undefined): ShowControlResult {
  const memory = Number(payload?.memory)
  if (!Number.isInteger(memory) || memory < 1 || memory > 99) {
    return { status: 'error', message: 'rc500.selectMemory: memory muss 1-99 sein.' }
  }
  rc500.output.send([0xc0 | (rc500.channel & 0x0f), memory - 1])
  return { status: 'ok', data: { memory } }
}

/**
 * The RC-500 has no SysEx protocol and no query mechanism at all - "a host cannot ask 'what
 * memory is currently loaded' or 'what is track 1's state right now'" (docs/protocol-notes.md,
 * transcribed from both official BOSS/Roland PDFs). Unlike Kemper's tuner flash or CQ-18T/MG-30's
 * real read, there is no message this plugin could send whose reply (or absence of one) would
 * actually prove the connection works - and guessing one (e.g. firing a CC that might coincide
 * with a live ASSIGN slot) risks disrupting whatever the currently loaded memory has mapped to
 * it. So this honestly reports that no automatic test exists, rather than faking a result.
 */
function test(): ShowControlResult {
  return { status: 'error', message: 'RC-500: kein automatischer Test möglich - das Gerät hat keine Rückmeldung.' }
}

export const rc500Translator: Translator = async (event) => {
  const rc500 = await resolveRc500Output()
  if (!rc500) return { status: 'error', message: 'RC-500: kein MIDI-Ausgang konfiguriert.' }

  switch (event.type) {
    case 'rc500.selectMemory':
      return selectMemory(rc500, event.payload)
    case 'test':
      return test()
    default:
      return { status: 'error', message: `RC-500: unbekannter Event-Typ "${event.type}".` }
  }
}
