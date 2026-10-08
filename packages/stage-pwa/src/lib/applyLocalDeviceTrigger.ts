import type { CapabilityId, DeviceTrigger } from 'shared-types'
import { getTranslator } from './clientTranslator'

/** Routes a relayed trigger (deviceTriggerStream.ts) to this device's translator for that
 * capability - the client-side counterpart to core-backend's PluginRegistry.trigger, for
 * capabilities this device is claimed for instead of a Stage-Server plugin. Every capability with a
 * local translator (Kemper, CQ-18T, MG-30, RC-500, Ui24R, the mock mixer/lighting …), not just the
 * two mocks it used to know - a Custom-Trigger for a Kemper bound to another tablet was dropped
 * there without a word (#408 review). The event keeps its logicalDeviceId, so the translator
 * drives the named device. */
export function applyLocalDeviceTrigger(trigger: DeviceTrigger): void {
  const translator = getTranslator(trigger.capability as CapabilityId)
  if (!translator) {
    console.warn('Relayed trigger for a capability without a local translator', trigger.capability)
    return
  }
  void Promise.resolve(translator(trigger.event)).then((result) => {
    if (result.status !== 'ok') console.warn('Relayed trigger failed', trigger.capability, result.message)
  })
}
