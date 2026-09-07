import type { LogicalDevice } from 'shared-types'
import { resolveHardwareBinding } from './hardwareRouting'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

/** Widget-facing shortcut for `resolveHardwareBinding` (hardwareRouting.ts) - every widget that
 * used to read `ShowState.deviceClaims[capability]` directly, then later a per-Setup binding,
 * now calls this instead. Each Logical Device carries its own live binding directly
 * (`logicalDevice.ts`), so this is now just a Logical Devices store read - no more active-Setup
 * indirection. */
export function useHardwareBindingFor(capability: string): LogicalDevice | null {
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  return resolveHardwareBinding(logicalDevices, capability)
}
