import { create } from 'zustand'
import type { DeviceTransportConfig } from 'shared-types'
import {
  getAllDeviceTransportConfigs,
  putDeviceTransportConfig,
  deviceTransportConfigChanges,
  switchDeviceTransportConfigWorkspace,
} from '../lib/deviceTransportConfigDb'

interface DeviceTransportConfigState {
  configs: DeviceTransportConfig[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  save: (config: DeviceTransportConfig) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<DeviceTransportConfig> | null = null

async function refresh(set: (partial: Partial<DeviceTransportConfigState>) => void) {
  const docs = await getAllDeviceTransportConfigs()
  set({ configs: docs })
}

/**
 * One tablet's own transport wiring per Logical Device it's bound to (#100's
 * DeviceTransportConfig, deviceTransportConfig.ts) - keyed `${deviceId}:${logicalDeviceId}`.
 * Replicates band-wide like everything else, but `DeviceTransportConfigSection.tsx`
 * (HardwareSetupManager.tsx) only ever renders an editable form for *this* device's own
 * entries - editing another tablet's wiring from here would be meaningless (a browser can only
 * enumerate what's plugged into itself).
 */
export const useDeviceTransportConfigStore = create<DeviceTransportConfigState>((set) => ({
  configs: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchDeviceTransportConfigWorkspace(workspaceId)
    set({ configs: [], loaded: false })

    await refresh(set)
    set({ loaded: true })

    changesHandle = deviceTransportConfigChanges({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
  save: async (config) => {
    await putDeviceTransportConfig(config)
  },
}))
