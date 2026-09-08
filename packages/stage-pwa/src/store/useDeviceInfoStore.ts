import { create } from 'zustand'
import { DEFAULT_DEVICE_INFO, type DeviceInfo } from 'shared-types'
import { subscribeToDeviceInfo } from '../lib/deviceInfoStream'

interface DeviceInfoState {
  deviceInfo: DeviceInfo
  init: (workspaceId: string) => Promise<void>
}

let unsubscribe: (() => void) | null = null

/**
 * The Device Ledger's live diagnostic data (DeviceLedgerView.tsx, Marco's explicit request) for
 * the active workspace - fed by the SSE stream (deviceInfoStream.ts), one shared subscription
 * regardless of how many components read it. Wired into App.tsx via `useWorkspaceResource`,
 * same lifecycle as `usePresenceStore`'s own subscription - `init` re-subscribes on every
 * workspace change, tearing down the previous stream first.
 */
export const useDeviceInfoStore = create<DeviceInfoState>((set) => ({
  deviceInfo: DEFAULT_DEVICE_INFO,
  init: async (workspaceId) => {
    unsubscribe?.()
    unsubscribe = null
    set({ deviceInfo: DEFAULT_DEVICE_INFO })

    unsubscribe = subscribeToDeviceInfo(workspaceId, (deviceInfo) => set({ deviceInfo }))
  },
}))
