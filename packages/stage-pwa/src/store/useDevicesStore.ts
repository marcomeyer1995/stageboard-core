import { create } from 'zustand'
import type { Device } from 'shared-types'
import { getAllDevices, putDevice, devicesChanges, switchDevicesWorkspace } from '../lib/devicesDb'
import { getDeviceId } from '../lib/deviceId'
import { guessDeviceName } from '../lib/guessDeviceName'

/** How rarely `init` bumps this device's own `lastSeenAt` - a coarse presence signal, not a
 * real-time one (see device.ts's doc comment), so there's no reason to write on every single
 * app load/reload. */
const LAST_SEEN_REFRESH_MS = 60 * 60_000

interface DevicesState {
  devices: Device[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<Device> | null = null

async function refresh(set: (partial: Partial<DevicesState>) => void) {
  const docs = await getAllDevices()
  set({ devices: docs })
}

/**
 * The workspace-wide DeviceRegistry (#10's first slice) - `init` doubles as this device's own
 * self-registration: create a registry entry the first time this device is ever seen in this
 * workspace (auto-named via guessDeviceName.ts, always renameable after - see
 * DeviceNameSettings.tsx), or just refresh its `lastSeenAt` if it's been a while.
 */
export const useDevicesStore = create<DevicesState>((set, get) => ({
  devices: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchDevicesWorkspace(workspaceId)
    set({ devices: [], loaded: false })

    const docs = await getAllDevices()
    const deviceId = getDeviceId()
    const mine = docs.find((device) => device.id === deviceId)
    if (!mine) {
      await putDevice({ id: deviceId, name: guessDeviceName(), lastSeenAt: Date.now() })
    } else if (Date.now() - mine.lastSeenAt > LAST_SEEN_REFRESH_MS) {
      await putDevice({ ...mine, lastSeenAt: Date.now() })
    }

    await refresh(set)
    set({ loaded: true })

    changesHandle = devicesChanges({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
  rename: async (id, name) => {
    const existing = get().devices.find((device) => device.id === id)
    await putDevice({ id, name, lastSeenAt: existing?.lastSeenAt ?? Date.now() })
  },
}))

/** Resolves a device id (e.g. ShowState.masterHolderId/audioOutputDeviceId) to its registered
 * name - null if that id has none yet (never registered, e.g. old data from before this
 * existed) so callers can fall back to a generic label instead of showing nothing. */
export function useDeviceName(id: string | null): string | null {
  const devices = useDevicesStore((state) => state.devices)
  if (!id) return null
  return devices.find((device) => device.id === id)?.name ?? null
}
