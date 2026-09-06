import type { DeviceTransportConfig } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type DeviceTransportConfigDoc = Doc<DeviceTransportConfig>

/** Replicates per workspace like everything else here, even though only `deviceId` itself can
 * meaningfully edit its own entries (#100) - so e.g. a future admin dashboard can still see
 * every tablet's wiring at a glance. */
const configs = createWorkspaceCollection<DeviceTransportConfig>('device-transport-config')

export const getDeviceTransportConfigDb = configs.getDb
export const switchDeviceTransportConfigWorkspace = configs.switchWorkspace
export const getAllDeviceTransportConfigs = configs.getAll
export const putDeviceTransportConfig = configs.put
export const removeDeviceTransportConfig = configs.remove
export const deviceTransportConfigChanges = configs.changes
