import { create } from 'zustand'
import { applyLocalDeviceTrigger } from '../lib/applyLocalDeviceTrigger'
import { subscribeToDeviceTriggers } from '../lib/deviceTriggerStream'
import { getDeviceId } from '../lib/deviceId'

interface DeviceTriggerListenerState {
  init: (workspaceId: string) => Promise<void>
}

let unsubscribe: (() => void) | null = null

/**
 * Keeps this device's relay trigger-stream open for the active workspace (#10, generalized
 * beyond audio - see deviceRelay.ts, core-backend), dispatching every incoming trigger into
 * whichever local mock engine mirrors its capability. Wired into App.tsx via
 * `useWorkspaceResource`, same lifecycle as `usePresenceStore`'s own subscription: `init`
 * re-subscribes on every workspace change, tearing down the previous stream first.
 */
export const useDeviceTriggerListenerStore = create<DeviceTriggerListenerState>(() => ({
  init: async (workspaceId) => {
    unsubscribe?.()
    unsubscribe = subscribeToDeviceTriggers(workspaceId, getDeviceId(), applyLocalDeviceTrigger)
  },
}))
