import { CAPABILITIES, type DeviceTrigger } from 'shared-types'
import { useLocalLightingStore } from '../store/useLocalLightingStore'
import { useLocalMixerStore } from '../store/useLocalMixerStore'

/** Routes a relayed trigger (deviceTriggerStream.ts) to whichever local mock engine mirrors
 * that capability - the client-side counterpart to core-backend's PluginRegistry.trigger, for
 * capabilities this device is claimed for instead of a Stage-Server plugin. */
export function applyLocalDeviceTrigger(trigger: DeviceTrigger): void {
  switch (trigger.capability) {
    case CAPABILITIES.lighting:
      useLocalLightingStore.getState().applyEvent(trigger.event)
      return
    case CAPABILITIES.mixer:
      useLocalMixerStore.getState().applyEvent(trigger.event)
      return
  }
}
