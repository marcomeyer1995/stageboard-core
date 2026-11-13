import { coalesced } from '../lib/coalesced'
import type { LocalChangesHandle } from '../lib/localChanges'
import { create } from 'zustand'
import { routedLogicalDevices, type LogicalDevice } from 'shared-types'
import { useStageMapStore } from './useStageMapStore'
import {
  getAllLogicalDevices,
  putLogicalDevice,
  logicalDevicesChanges,
  removeLogicalDevice,
  switchLogicalDevicesWorkspace,
} from '../lib/logicalDevicesDb'

interface LogicalDevicesState {
  /** As the stage map routes them (docs/31 §6 step 2): every plugin device executes where the map
   * sends it - what everything that asks "who executes this?" reads. */
  devices: LogicalDevice[]
  /** As stored - the binding before the map, and what saving keeps. */
  stored: LogicalDevice[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  save: (device: LogicalDevice) => Promise<void>
  remove: (id: string) => Promise<void>
}

let changesHandle: LocalChangesHandle<LogicalDevice> | null = null

const routed = (docs: LogicalDevice[]) => {
  const map = useStageMapStore.getState()
  return map.loaded ? routedLogicalDevices(docs, map, map.front) : docs
}

async function refresh(set: (partial: Partial<LogicalDevicesState>) => void) {
  const docs = await getAllLogicalDevices()
  set({ stored: docs, devices: routed(docs) })
}

/**
 * Named device roles a widget/cue can eventually target (#10's LogicalDevice, logicalDevice.ts) -
 * e.g. "Marco's Kemper". Created/edited via SystemView's "Hardware" tab
 * (HardwareSetupManager.tsx); read by hardwareRouting.ts to resolve a capability's active
 * binding.
 */
export const useLogicalDevicesStore = create<LogicalDevicesState>((set) => ({
  devices: [],
  stored: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchLogicalDevicesWorkspace(workspaceId)
    set({ devices: [], stored: [], loaded: false })

    await refresh(set)
    set({ loaded: true })

    changesHandle = logicalDevicesChanges()
    changesHandle.on('change', coalesced(() => refresh(set)))
  },
  // A device shown with the map's target is saved with its own: the map's choice never becomes the
  // stored binding.
  save: async (device) => {
    const own = useLogicalDevicesStore.getState().stored.find((d) => d.id === device.id)
    const routedTarget = useLogicalDevicesStore.getState().devices.find((d) => d.id === device.id)?.executionTarget
    await putLogicalDevice(own && device.executionTarget === routedTarget ? { ...device, executionTarget: own.executionTarget } : device)
  },
  remove: async (id) => {
    await removeLogicalDevice(id)
  },
}))

// The map changed (a tick, a cable, another app in front, another setup for the Gig): route again.
useStageMapStore.subscribe((map, before) => {
  if (map.setups === before.setups && map.equipment === before.equipment && map.front === before.front && map.active === before.active && map.loaded === before.loaded) return
  const { stored } = useLogicalDevicesStore.getState()
  useLogicalDevicesStore.setState({ devices: routed(stored) })
})
