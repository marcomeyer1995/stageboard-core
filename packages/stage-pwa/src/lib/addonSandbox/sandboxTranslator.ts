import type { CapabilityId, ShowControlResult } from 'shared-types'
import i18n from '../../i18n'
import { useDeviceTransportConfigStore } from '../../store/useDeviceTransportConfigStore'
import { useLogicalDevicesStore } from '../../store/useLogicalDevicesStore'
import type { Translator } from '../clientTranslator'
import { getDeviceId } from '../deviceId'
import { resolveTargetDevice } from '../hardwareRouting'
import { midiOutputFor } from '../mapMidi'
import { midiSendTime } from '../midiSendTime'
import { isWebMidiSupported } from '../webMidi'
import type { AddonSandbox, SandboxIO } from './sandboxHost'

/**
 * A Translator for a sandboxed add-on (#757): StageBoard finds the device the event is for (the
 * named one, else the first with the capability), its port (the stage map's cable, else the port
 * set up on this device) and channel - exactly as the built-in device translators do - and hands
 * the add-on only the event and the channel. What the add-on sends goes to that port, nowhere else.
 */
export function sandboxTranslator(capability: CapabilityId, sandbox: AddonSandbox, deviceName: string): Translator {
  return async (event) => {
    if (!isWebMidiSupported()) return { status: 'error', message: i18n.t('plugins:msg.noWebMidi', { device: deviceName }) }
    const logicalDevice = resolveTargetDevice(useLogicalDevicesStore.getState().devices, capability, event.logicalDeviceId)
    if (!logicalDevice) return { status: 'error', message: i18n.t('plugins:msg.noMidiOut', { device: deviceName }) }
    const config = useDeviceTransportConfigStore.getState().configs.find((c) => c.deviceId === getDeviceId() && c.logicalDeviceId === logicalDevice.id)
    const output = await midiOutputFor(logicalDevice.id, config?.values.midiOutputId, midiSendTime(event))
    if (!output) return { status: 'error', message: i18n.t('plugins:msg.noMidiOut', { device: deviceName }) }
    const channel = Number(config?.values.midiChannel)
    const io: SandboxIO = {
      context: { midiChannel: Number.isInteger(channel) && channel >= 1 && channel <= 16 ? channel : 1 },
      send: (bytes) => output.send(bytes),
      sendAndWait: (bytes, prefix, timeoutMs) => sendAndWaitForReply(output, bytes, prefix, timeoutMs),
    }
    const result: ShowControlResult = await sandbox.run({ type: event.type, ...(event.payload ? { payload: event.payload } : {}) }, io)
    return result
  }
}

/**
 * Attaches the listener on the input of the same device *before* sending, then waits for a message
 * starting with `prefix` (a reply can arrive faster than a listener attached afterwards - found with
 * the real MG-30 over USB, 2026-09-08). Null after the timeout or without a matching input.
 */
export async function sendAndWaitForReply(output: MIDIOutput, bytes: number[], prefix: number[], timeoutMs: number): Promise<Uint8Array | null> {
  let access: MIDIAccess
  try {
    access = await navigator.requestMIDIAccess({ sysex: true })
  } catch {
    return null
  }
  const name = (output.name ?? '').toLowerCase()
  // The input of the same device: the same name, or one contained in the other (the systems name
  // the two directions slightly differently).
  const inputs = Array.from(access.inputs.values())
  const named = (candidate: MIDIInput) => (candidate.name ?? '').toLowerCase()
  const input = name === '' ? undefined : (inputs.find((c) => named(c) === name) ?? inputs.find((c) => named(c) !== '' && (named(c).includes(name) || name.includes(named(c)))))
  if (!input) {
    output.send(bytes)
    return null
  }
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      input.removeEventListener('midimessage', handler)
      resolve(null)
    }, timeoutMs)
    function handler(event: MIDIMessageEvent) {
      const data = event.data
      if (!data || settled) return
      if (prefix.every((byte, i) => data[i] === byte)) {
        settled = true
        clearTimeout(timer)
        input!.removeEventListener('midimessage', handler)
        resolve(data)
      }
    }
    input.addEventListener('midimessage', handler)
    output.send(bytes)
  })
}
