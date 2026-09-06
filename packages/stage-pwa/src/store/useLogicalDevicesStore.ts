import { create } from 'zustand'
import type { LogicalDevice } from 'shared-types'
import {
  getAllLogicalDevices,
  putLogicalDevice,
  logicalDevicesChanges,
  removeLogicalDevice,
  switchLogicalDevicesWorkspace,
} from '../lib/logicalDevicesDb'

interface LogicalDevicesState {
  devices: LogicalDevice[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  save: (device: LogicalDevice) => Promise<void>
  remove: (id: string) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<LogicalDevice> | null = null

async function refresh(set: (partial: Partial<LogicalDevicesState>) => void) {
  const docs = await getAllLogicalDevices()
  set({ devices: docs })
}

/**
 * Named device roles a widget/cue can eventually target (#10's LogicalDevice, logicalDevice.ts) -
 * e.g. "Marco's Kemper". Created/edited via SystemView's "Hardware" tab
 * (HardwareSetupManager.tsx); read by hardwareRouting.ts to resolve a capability's active
 * binding.
 */
export const useLogicalDevicesStore = create<LogicalDevicesState>((set) => ({
  devices: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchLogicalDevicesWorkspace(workspaceId)
    set({ devices: [], loaded: false })

    await refresh(set)
    set({ loaded: true })

    changesHandle = logicalDevicesChanges({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
  save: async (device) => {
    await putLogicalDevice(device)
  },
  remove: async (id) => {
    await removeLogicalDevice(id)
  },
}))
