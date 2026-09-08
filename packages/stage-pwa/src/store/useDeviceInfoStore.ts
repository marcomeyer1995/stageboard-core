import { create } from 'zustand'
import { DEFAULT_DEVICE_INFO, type DeviceInfo } from 'shared-types'
import { fetchDeviceInfo } from '../lib/fetchDeviceInfo'

interface DeviceInfoState {
  deviceInfo: DeviceInfo
  init: (workspaceId: string) => Promise<void>
  stop: () => void
}

/** A few seconds of staleness is an acceptable trade for not holding a connection open - see
 * this file's own doc comment. */
const POLL_INTERVAL_MS = 4_000

let pollInterval: ReturnType<typeof setInterval> | null = null

/**
 * The Device Ledger's live diagnostic data (DeviceLedgerView.tsx, Marco's explicit request) for
 * the active workspace - fed by polling a plain one-shot GET (fetchDeviceInfo.ts), deliberately
 * *not* an SSE/EventSource push like `usePresenceStore`'s own subscription.
 *
 * `init`/`stop` are called directly by `DeviceLedgerView.tsx`'s own mount/unmount (not wired
 * into App.tsx's always-on `useWorkspaceResource` list), so polling only happens while that
 * screen is actually open. Found live (Marco, 2026-09-08): this app already holds ~5 other
 * long-lived SSE/EventSource connections open per tab for the whole session (presence,
 * trigger-stream, discovery, plugin-health x2) against a plain HTTPS/1.1 dev server - no HTTP/2
 * negotiated - already sitting at/near Chrome's 6-connections-per-origin cap. A 6th persistent
 * stream here starved one-off requests (report POSTs, and - worse - the admin revoke action,
 * exactly while someone had this screen open to use it) of a connection entirely. Polling
 * doesn't hold anything open between requests, so - unlike a stream - it doesn't matter whether
 * this screen happens to be open or not; it never competes for that same tight budget. Reported
 * self-info still reports continuously in App.tsx (useDeviceInfoReporter.ts) via the same kind
 * of one-off fetch, unaffected by any of this.
 */
export const useDeviceInfoStore = create<DeviceInfoState>((set) => ({
  deviceInfo: DEFAULT_DEVICE_INFO,
  init: async (workspaceId) => {
    if (pollInterval) clearInterval(pollInterval)
    set({ deviceInfo: DEFAULT_DEVICE_INFO })

    const poll = async () => {
      const deviceInfo = await fetchDeviceInfo(workspaceId)
      if (deviceInfo) set({ deviceInfo })
    }
    await poll()
    pollInterval = setInterval(poll, POLL_INTERVAL_MS)
  },
  stop: () => {
    if (pollInterval) clearInterval(pollInterval)
    pollInterval = null
    set({ deviceInfo: DEFAULT_DEVICE_INFO })
  },
}))
