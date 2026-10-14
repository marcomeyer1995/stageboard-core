import { CAPABILITIES, type LogicalDevice, type ShowControlResult, type DeviceTransportConfig } from 'shared-types'
import type { Translator } from './clientTranslator'
import { getDeviceId } from './deviceId'
import { MIDI_STOP } from './midiClock'
import { getMidiOutputById, listMidiOutputs } from './webMidiOutput'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

export const MIDI_CLOCK_CAPABILITY = CAPABILITIES.midiClock

/** The MIDI-Clock devices this device sends clock for (#478). */
export function myClockDevices(devices: readonly LogicalDevice[], deviceId = getDeviceId()): LogicalDevice[] {
  return devices.filter((d) => d.capability === MIDI_CLOCK_CAPABILITY && d.executionTarget === deviceId)
}

/**
 * The WebMIDI output a MIDI-Clock device is set to on this device - by its stored id, else by the
 * name stored next to it (`midiOutputIdName`): Android hands out new port ids after a replug.
 */
export async function resolveClockOutput(logicalDeviceId: string, configs: readonly DeviceTransportConfig[]): Promise<MIDIOutput | null> {
  const config = configs.find((c) => c.deviceId === getDeviceId() && c.logicalDeviceId === logicalDeviceId)
  const id = config?.values.midiOutputId
  if (!id) return null
  const byId = await getMidiOutputById(id)
  if (byId) return byId
  const name = config.values.midiOutputIdName
  if (!name) return null
  const match = (await listMidiOutputs()).find((o) => o.name === name)
  return match ? getMidiOutputById(match.id) : null
}

/** "Testen" in device setup: a harmless Stop - shows that the port is reachable. */
export const midiClockTranslator: Translator = async (event): Promise<ShowControlResult> => {
  if (event.type !== 'test')
    return {
      status: 'error',
      message: `MIDI-Clock: unbekannter Event-Typ "${event.type}".`,
    }
  const deviceId = event.logicalDeviceId ?? myClockDevices(useLogicalDevicesStore.getState().devices)[0]?.id
  const output = deviceId ? await resolveClockOutput(deviceId, useDeviceTransportConfigStore.getState().configs) : null
  if (!output)
    return {
      status: 'error',
      message: 'MIDI-Clock: kein MIDI-Ausgang verbunden.',
    }
  output.send([MIDI_STOP])
  return { status: 'ok', data: { output: output.name ?? output.id } }
}
