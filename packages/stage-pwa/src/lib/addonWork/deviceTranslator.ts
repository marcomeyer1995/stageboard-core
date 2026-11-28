import type { CapabilityId, ShowControlResult } from 'shared-types'
import i18n from '../../i18n'
import { useDeviceTransportConfigStore } from '../../store/useDeviceTransportConfigStore'
import { useLogicalDevicesStore } from '../../store/useLogicalDevicesStore'
import { sendAndWaitForReply } from '../addonSandbox/sandboxTranslator'
import type { Translator } from '../clientTranslator'
import { getDeviceId } from '../deviceId'
import { resolveTargetDevice } from '../hardwareRouting'
import { midiOutputFor } from '../mapMidi'
import { midiSendTime } from '../midiSendTime'
import { isWebMidiSupported } from '../webMidi'
import type { LocalAddonMethods } from './localMethods'

/**
 * A MIDI device whose knowledge is an **add-on on the contract** (docs/36, #964): the same add-on - the same work script - a laptop host runs for a
 * device plugged into it (`core-backend/plugins/midiDevicePlugin.ts`). StageBoard finds the device the cue is for (the named one, else the first with
 * the capability), its port (the stage map's cable, else the port set up on this device) and channel, and hands the add-on the cue and the channel;
 * what the add-on sends goes to that port, nowhere else. The cue's send time travels with the port (`midiOutputFor(..., sendAt)`), so the Worker's hop
 * does not move it.
 */
export function addonDeviceTranslator(capability: CapabilityId, addonId: string, deviceName: string, methods: () => Promise<LocalAddonMethods>): Translator {
  return async (event) => {
    if (!isWebMidiSupported()) return { status: 'error', message: i18n.t('plugins:msg.noWebMidi', { device: deviceName }) }
    const logicalDevice = resolveTargetDevice(useLogicalDevicesStore.getState().devices, capability, event.logicalDeviceId)
    if (!logicalDevice) return { status: 'error', message: i18n.t('plugins:msg.noMidiOut', { device: deviceName }) }
    const config = useDeviceTransportConfigStore.getState().configs.find((c) => c.deviceId === getDeviceId() && c.logicalDeviceId === logicalDevice.id)
    const output = await midiOutputFor(logicalDevice.id, config?.values.midiOutputId, midiSendTime(event))
    if (!output) return { status: 'error', message: i18n.t('plugins:msg.noMidiOut', { device: deviceName }) }
    const channel = Number(config?.values.midiChannel)
    const answer = await (await methods()).call(
      addonId,
      'event',
      { type: event.type, ...(event.payload ? { payload: event.payload } : {}), midiChannel: Number.isInteger(channel) && channel >= 1 && channel <= 16 ? channel : 1 },
      { midi: { send: (bytes) => output.send(bytes), sendAndWait: (bytes, prefix, timeoutMs) => sendAndWaitForReply(output, bytes, prefix, timeoutMs) } },
    )
    return answer.ok ? (answer.body as ShowControlResult) : { status: 'error', message: answer.error.message }
  }
}
