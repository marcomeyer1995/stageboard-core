import { create } from 'zustand'
import type { Device } from 'shared-types'
import { getAllDevices, putDevice, devicesChanges, switchDevicesWorkspace } from '../lib/devicesDb'
import { getDeviceId } from '../lib/deviceId'
import { guessDeviceName } from '../lib/guessDeviceName'
import { getStageServerUrl } from '../lib/stageServer'
import { useDialogStore } from './useDialogStore'
import { useWorkspaceStore } from './useWorkspaceStore'

/** How rarely `init` bumps this device's own `lastSeenAt` - a coarse presence signal, not a
 * real-time one (see device.ts's doc comment), so there's no reason to write on every single
 * app load/reload. */
const LAST_SEEN_REFRESH_MS = 60 * 60_000

interface DevicesState {
  devices: Device[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  /** Device Ledger's admin-only kick/restore (DeviceLedgerView.tsx, Marco's explicit request) -
   * same placement/shape as useWorkspaceStore.ts's `rotateAccessCode` (reads this device's own
   * admin credentials off the active Workspace, POSTs, no optimistic local update - the live
   * `devicesChanges` subscription in `init()` already picks up the synced result). `null` means
   * the call couldn't even be attempted (no Stage-Server, or this device isn't that workspace's
   * admin) - the caller shows nothing more specific than "not possible right now" either way,
   * matching `rotateAccessCode`'s own contract. */
  revoke: (workspaceId: string, id: string, revoked: boolean) => Promise<boolean>
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
      const now = Date.now()
      await putDevice({ id: deviceId, name: guessDeviceName(), lastSeenAt: now, firstSeenAt: now, revoked: false })
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
    // Spreads `...existing` rather than reconstructing a bare {id, name, lastSeenAt} - devicesDb
    // .put() replaces the full doc body on every call, so a naive reconstruction here would
    // silently drop revoked/firstSeenAt for any device this device happens to rename. The
    // `?? ` fallbacks only ever apply to the (in practice unreached) case of renaming an id this
    // device has never seen a doc for at all.
    await putDevice({
      ...existing,
      id,
      name,
      lastSeenAt: existing?.lastSeenAt ?? Date.now(),
      firstSeenAt: existing?.firstSeenAt ?? Date.now(),
      revoked: existing?.revoked ?? false,
    })
  },
  revoke: async (workspaceId, id, revoked) => {
    const base = getStageServerUrl()
    const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
    if (!base || !workspace?.isAdmin || !workspace.couchPassword || !workspace.username) {
      return false
    }

    try {
      const response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/devices/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUsername: workspace.username, adminPassword: workspace.couchPassword, revoked }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return true
    } catch (err) {
      console.error('Failed to update device revoked status', err)
      void useDialogStore.getState().alert('Aktion nicht möglich - Stage-Server nicht erreichbar.')
      return false
    }
  },
}))

/** Resolves a device id (e.g. ShowState.masterHolderId or a LogicalDevice's own executionTarget) to
 * its registered name - null if that id has none yet (never registered, e.g. old data from
 * before this existed) so callers can fall back to a generic label instead of showing nothing. */
export function useDeviceName(id: string | null): string | null {
  const devices = useDevicesStore((state) => state.devices)
  if (!id) return null
  return devices.find((device) => device.id === id)?.name ?? null
}
