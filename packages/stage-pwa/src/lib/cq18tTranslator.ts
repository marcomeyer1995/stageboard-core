import type { ShowControlResult } from 'shared-types'
import { getDeviceId } from './deviceId'
import type { Translator } from './clientTranslator'
import { isWebMidiSupported } from './webMidi'
import { getMidiOutputById, sendNrpn } from './webMidiOutput'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

/**
 * A real, installable plugin (pluginCatalog.ts) rather than a mock - its own dedicated
 * capability string, not `CAPABILITIES.mixer`: `clientTranslator.ts`'s `TRANSLATORS` map is
 * keyed one-Translator-per-capability, globally, and that slot is already the built-in local
 * mock-mixer store (`useLocalMixerStore`) - reusing 'mixer' here wouldn't make this plugin drive
 * that widget, it would just silently replace the mock mixer's own translator. Same reasoning
 * kemperTranslator.ts's `KEMPER_CAPABILITY` already documents.
 */
export const CQ18T_CAPABILITY = 'cq18t-control'

/**
 * NRPN parameter addresses (Allen & Heath "CQ MIDI Protocol", Firmware V1.2.0, Issue 5) -
 * transcribed from `~/Device Emulators/Allen Heath CQ18T Emulator/cq18t_emulator/addressing.py`,
 * itself transcribed from the protocol PDF's real text layer. Only the subset this plugin
 * actually uses: per-input-channel mute + level-to-Main-LR, and the Main LR mute used for the
 * Discovery trigger. The full protocol also has per-output/FX routing and pan - not implemented
 * here, same "cover the common case, not the whole manual" scope Kemper's plugin already sets.
 */
const MAIN_LR_MUTE_ADDRESS: [number, number] = [0x00, 0x44]
function inputMuteAddress(channel: number): [number, number] {
  return [0x00, channel - 1] // Ip1..Ip16 -> LSB 0x00..0x0F
}
function inputLevelToMainAddress(channel: number): [number, number] {
  return [0x40, channel - 1] // Ip1..Ip16 -> Main LR, LSB 0x00..0x0F
}

/**
 * dB -> 14-bit raw NRPN value, audio-taper curve - the protocol doc gives a sparse table of
 * example (dB, VC, VF) points rather than a formula (it's a non-linear taper), so this
 * interpolates between the documented anchors exactly like the emulator's own `curves.py`
 * (`db_to_raw`) does. Adequate for "set the level to roughly this dB", not bit-exact audio
 * calibration - same caveat the emulator's own doc comment gives.
 */
const LEVEL_TABLE: [number, number][] = [
  [-200, 0x0000], [-89, 0x00c0], [-85, 0x0100], [-80, 0x0140], [-75, 0x01c0], [-70, 0x0200],
  [-65, 0x0280], [-60, 0x0300], [-55, 0x0380], [-50, 0x0400], [-45, 0x0600], [-40, 0x07c0],
  [-38, 0x0940], [-36, 0x0ac0], [-35, 0x0b80], [-34, 0x0c80], [-33, 0x0d40], [-32, 0x0e00],
  [-31, 0x0ec0], [-30, 0x0f80], [-29, 0x1040], [-28, 0x1100], [-27, 0x11c0], [-26, 0x1280],
  [-25, 0x1340], [-24, 0x1440], [-23, 0x1500], [-22, 0x15c0], [-21, 0x1680], [-20, 0x1740],
  [-19, 0x1800], [-18, 0x18c0], [-17, 0x1980], [-16, 0x1a40], [-15, 0x1b00], [-14, 0x1c00],
  [-13, 0x1cc0], [-12, 0x1d80], [-11, 0x1e40], [-10, 0x1f00], [-9, 0x20c0], [-8, 0x2240],
  [-7, 0x2400], [-6, 0x2580], [-5, 0x2740], [-4, 0x2940], [-3, 0x2b40], [-2, 0x2d00],
  [-1, 0x2f00], [0, 0x3100], [1, 0x32c0], [2, 0x3480], [3, 0x3640], [4, 0x3800],
  [5, 0x39c0], [6, 0x3ac0], [7, 0x3c00], [8, 0x3d40], [9, 0x3e80], [10, 0x3fc0],
]

function dbToRaw(db: number): number {
  const clamped = Math.max(LEVEL_TABLE[0][0], Math.min(LEVEL_TABLE[LEVEL_TABLE.length - 1][0], db))
  for (let i = 0; i < LEVEL_TABLE.length - 1; i++) {
    const [dbLo, rawLo] = LEVEL_TABLE[i]
    const [dbHi, rawHi] = LEVEL_TABLE[i + 1]
    if (clamped >= dbLo && clamped <= dbHi) {
      if (dbHi === dbLo) return rawLo
      const t = (clamped - dbLo) / (dbHi - dbLo)
      return Math.round(rawLo + t * (rawHi - rawLo))
    }
  }
  return LEVEL_TABLE[LEVEL_TABLE.length - 1][1]
}

function rawToNrpnData(raw: number): [number, number] {
  return [(raw >> 7) & 0x7f, raw & 0x7f]
}

interface Cq18tOutput {
  output: MIDIOutput
  channel: number // 0-indexed
}

/** Same "first Logical Device with this capability, bound on this device" resolution as
 * kemperTranslator.ts's `resolveKemperOutput` - see its own doc comment for why. */
async function resolveCq18tOutput(): Promise<Cq18tOutput | null> {
  const logicalDevice = useLogicalDevicesStore.getState().devices.find((d) => d.capability === CQ18T_CAPABILITY)
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

function setLevel(cq18t: Cq18tOutput, payload: Record<string, unknown> | undefined): ShowControlResult {
  const channel = Number(payload?.channel)
  const db = Number(payload?.db)
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) {
    return { status: 'error', message: 'cq18t.setLevel: channel muss 1-16 sein.' }
  }
  if (!Number.isFinite(db)) return { status: 'error', message: 'cq18t.setLevel: db fehlt.' }
  const [addrMsb, addrLsb] = inputLevelToMainAddress(channel)
  const [dataMsb, dataLsb] = rawToNrpnData(dbToRaw(db))
  sendNrpn(cq18t.output, cq18t.channel, addrMsb, addrLsb, dataMsb, dataLsb)
  return { status: 'ok', data: { channel, db } }
}

function setMute(cq18t: Cq18tOutput, payload: Record<string, unknown> | undefined): ShowControlResult {
  const target = payload?.channel
  const muted = payload?.muted === true
  const [addrMsb, addrLsb] = target === 'main' ? MAIN_LR_MUTE_ADDRESS : inputMuteAddress(Number(target))
  if (target !== 'main' && (!Number.isInteger(Number(target)) || Number(target) < 1 || Number(target) > 16)) {
    return { status: 'error', message: 'cq18t.setMute: channel muss 1-16 oder "main" sein.' }
  }
  sendNrpn(cq18t.output, cq18t.channel, addrMsb, addrLsb, 0x00, muted ? 0x01 : 0x00)
  return { status: 'ok', data: { channel: target, muted } }
}

/**
 * Read-only NRPN "Get" (CC96=0x7F after addressing) on Ip1's mute state - deliberately never a
 * mute/level *set*: unlike Kemper's tuner-flash test (harmless for a guitar processor), a
 * mixer's "Testen" button must never be able to audibly disrupt a live channel just from being
 * clicked. This proves the connection is alive by sending real protocol traffic (verifiable in
 * the emulator's own --verbose log) without touching any live state.
 */
function test(cq18t: Cq18tOutput): ShowControlResult {
  const [addrMsb, addrLsb] = inputMuteAddress(1)
  sendNrpn(cq18t.output, cq18t.channel, addrMsb, addrLsb, 0, 0) // placeholder data, ignored by a Get
  // CC96=0x7F is the documented "Get" - not a 4-controller NRPN message, so sent directly rather
  // than via sendNrpn (which always sends CC6/CC38 data bytes, meaningless for a Get).
  cq18t.output.send([0xb0 | (cq18t.channel & 0x0f), 96, 0x7f])
  return { status: 'ok', message: 'Get-Anfrage für Ip1-Mute gesendet.' }
}

export const cq18tTranslator: Translator = async (event) => {
  if (!isWebMidiSupported()) return { status: 'error', message: 'CQ-18T: WebMIDI nicht unterstützt.' }
  const cq18t = await resolveCq18tOutput()
  if (!cq18t) return { status: 'error', message: 'CQ-18T: kein MIDI-Ausgang konfiguriert.' }

  switch (event.type) {
    case 'cq18t.setLevel':
      return setLevel(cq18t, event.payload)
    case 'cq18t.setMute':
      return setMute(cq18t, event.payload)
    case 'test':
      return test(cq18t)
    default:
      return { status: 'error', message: `CQ-18T: unbekannter Event-Typ "${event.type}".` }
  }
}
