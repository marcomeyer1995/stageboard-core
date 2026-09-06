import type { HardwareBinding } from 'shared-types'
import { resolveHardwareBinding } from './hardwareRouting'
import { useHardwareSetupsStore } from '../store/useHardwareSetupsStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { useShowStateStore } from '../store/useShowStateStore'

/** Widget-facing shortcut for `resolveHardwareBinding` (hardwareRouting.ts), reading the active
 * HardwareSetup (ShowState.activeHardwareSetupId) and the workspace's Logical Devices off their
 * own stores - every widget that used to read `ShowState.deviceClaims[capability]` directly now
 * calls this instead. */
export function useHardwareBindingFor(capability: string): HardwareBinding | null {
  const activeHardwareSetupId = useShowStateStore((state) => state.state.activeHardwareSetupId)
  const setups = useHardwareSetupsStore((state) => state.setups)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const hardwareSetup = setups.find((setup) => setup.id === activeHardwareSetupId) ?? null
  return resolveHardwareBinding(logicalDevices, hardwareSetup, capability)
}
