import type { LogicalDevice } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type LogicalDeviceDoc = Doc<LogicalDevice>

/** Logical Devices replicate per workspace, same as the physical DeviceRegistry (devicesDb.ts) -
 * naming one on one tablet is visible to the whole band, not just the device that named it. */
const logicalDevices = createWorkspaceCollection<LogicalDevice>('logical-devices')

export const getLogicalDevicesDb = logicalDevices.getDb
export const switchLogicalDevicesWorkspace = logicalDevices.switchWorkspace
export const getAllLogicalDevices = logicalDevices.getAll
export const putLogicalDevice = logicalDevices.put
export const removeLogicalDevice = logicalDevices.remove
export const logicalDevicesChanges = logicalDevices.changes
