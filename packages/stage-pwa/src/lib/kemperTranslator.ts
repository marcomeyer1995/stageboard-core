import type { ShowControlResult } from 'shared-types'
import { getDeviceId } from './deviceId'
import type { Translator } from './clientTranslator'
import { getMidiOutputById, sendControlChange } from './webMidiOutput'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

/**
 * A real, installable plugin (PluginManager.tsx's CATALOG) rather than a mock - its own
 * dedicated capability string, not one of `capability.ts`'s core `CAPABILITIES` (that const is
 * StageBoard's own built-in vocabulary; a device-specific plugin is exactly the "community
 * plugin brings its own" case its doc comment describes) and not reused across device families.
 */
export const KEMPER_CAPABILITY = 'kemper-control'

/** The Kemper Profiler's "Table 1" plain MIDI CC layer (kemper-profiler-midi-parameter-
 * documentation.pdf, also `~/Device Emulators/Kemper Emulator/kemper_emulator/cc_map.py`) - the
 * NRPN/SysEx layers (continuous parameters, rig renaming) aren't implemented yet. */
const KEMPER_CC = {
  performancePreselect: 47,
  slot: [50, 51, 52, 53, 54], // index 0 = slot 1 ... index 4 = slot 5
  tuner: 31,
} as const

const STOMP_CC: Record<string, number> = { A: 17, B: 18, C: 19, D: 20, X: 22, MOD: 24, DELAY: 26, REVERB: 28, ALL: 16 }
const STOMP_CC_WITH_TAIL: Record<string, number> = { DELAY: 27, REVERB: 29 }

interface KemperOutput {
  output: MIDIOutput
  channel: number // 0-indexed
}

/**
 * Which physical Kemper this tablet talks to right now - the first Logical Device declaring
 * `kemper-control` bound (via DeviceTransportConfig) on this device. Same "first match wins"
 * simplification hardwareRouting.ts/resolveHardwareBinding already use elsewhere in this
 * codebase for the analogous "usually exactly one instance per tablet" case; a `ShowControlEvent`
 * carries no logicalDeviceId to disambiguate further (clientTranslator.ts's Translator contract).
 */
async function resolveKemperOutput(): Promise<KemperOutput | null> {
  const logicalDevice = useLogicalDevicesStore.getState().devices.find((d) => d.capability === KEMPER_CAPABILITY)
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

function selectRig(kemper: KemperOutput, payload: Record<string, unknown> | undefined): ShowControlResult {
  const performance = Number(payload?.performance)
  const slot = Number(payload?.slot)
  if (!Number.isInteger(performance) || performance < 0 || performance > 124) {
    return { status: 'error', message: 'kemper.selectRig: performance muss 0-124 sein.' }
  }
  if (!Number.isInteger(slot) || slot < 1 || slot > 5) {
    return { status: 'error', message: 'kemper.selectRig: slot muss 1-5 sein.' }
  }
  sendControlChange(kemper.output, kemper.channel, KEMPER_CC.performancePreselect, performance)
  sendControlChange(kemper.output, kemper.channel, KEMPER_CC.slot[slot - 1], 127)
  return { status: 'ok', data: { performance, slot } }
}

function stomp(kemper: KemperOutput, payload: Record<string, unknown> | undefined): ShowControlResult {
  const name = String(payload?.stomp ?? '').toUpperCase()
  const withTail = payload?.tail === true
  const cc = (withTail && STOMP_CC_WITH_TAIL[name]) || STOMP_CC[name]
  if (!cc) return { status: 'error', message: `kemper.stomp: unbekanntes Stomp-Slot "${name}".` }
  sendControlChange(kemper.output, kemper.channel, cc, 127)
  return { status: 'ok', data: { stomp: name, tail: withTail } }
}

async function test(kemper: KemperOutput): Promise<ShowControlResult> {
  // Visible/audible "this connection is alive" ping any plugin's 'test' handler can implement
  // meaningfully (see HardwareSetupManager.tsx's "Testen" button) - flashes the tuner display.
  sendControlChange(kemper.output, kemper.channel, KEMPER_CC.tuner, 127)
  await new Promise((resolve) => setTimeout(resolve, 150))
  sendControlChange(kemper.output, kemper.channel, KEMPER_CC.tuner, 0)
  return { status: 'ok' }
}

export const kemperTranslator: Translator = async (event) => {
  const kemper = await resolveKemperOutput()
  if (!kemper) return { status: 'error', message: 'Kemper: kein MIDI-Ausgang konfiguriert.' }

  switch (event.type) {
    case 'kemper.selectRig':
      return selectRig(kemper, event.payload)
    case 'kemper.stomp':
      return stomp(kemper, event.payload)
    case 'test':
      return test(kemper)
    default:
      return { status: 'error', message: `Kemper: unbekannter Event-Typ "${event.type}".` }
  }
}
