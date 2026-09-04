import type { Device } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type DeviceDoc = Doc<Device>

/** Registered devices replicate per workspace, same as plugins/profiles - naming a device on
 * one tablet is visible to the whole band, not just the device that named it. */
const devices = createWorkspaceCollection<Device>('devices')

export const getDevicesDb = devices.getDb
export const switchDevicesWorkspace = devices.switchWorkspace
export const getAllDevices = devices.getAll
export const putDevice = devices.put
export const devicesChanges = devices.changes
