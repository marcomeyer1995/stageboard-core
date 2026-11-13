import { create } from 'zustand'
import { DEFAULT_DEVICE_INFO, type DeviceInfo } from 'shared-types'
import { fetchDeviceInfo } from '../lib/fetchDeviceInfo'
import { deliverInBackground, dropFromInbox } from '../lib/inbox'
import { getStageServerUrl } from '../lib/stageServer'

interface DeviceInfoState {
  deviceInfo: DeviceInfo
  /** The first answer from the Stage-Server arrived - before it, every device looks inactive. */
  loaded: boolean
  /** Whether the Stage-Server answered the last poll (#747, the map's check) - null before the
   * first one, and where no Stage-Server is set. */
  reachable: boolean | null
  init: (workspaceId: string) => Promise<void>
  stop: () => void
}

/** A few seconds of staleness is an acceptable trade for not holding a connection open - see
 * this file's own doc comment. */
const POLL_INTERVAL_MS = 4_000
const INBOX_CHANNEL = 'device-info'

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
  loaded: false,
  reachable: null,
  init: async (workspaceId) => {
    if (pollInterval) clearInterval(pollInterval)
    set({ deviceInfo: DEFAULT_DEVICE_INFO, loaded: false, reachable: null })

    const poll = async () => {
      const deviceInfo = await fetchDeviceInfo(workspaceId)
      const reachable = getStageServerUrl() ? deviceInfo !== null : null
      // Only a status: applied in free time (docs/26), the newest wins.
      deliverInBackground(INBOX_CHANNEL, { deviceInfo, reachable }, (value) => {
        if (value.deviceInfo) set({ deviceInfo: value.deviceInfo, loaded: true, reachable: value.reachable })
        else set({ reachable: value.reachable })
      })
    }
    await poll()
    pollInterval = setInterval(poll, POLL_INTERVAL_MS)
  },
  stop: () => {
    if (pollInterval) clearInterval(pollInterval)
    pollInterval = null
    dropFromInbox(INBOX_CHANNEL)
    set({ deviceInfo: DEFAULT_DEVICE_INFO, loaded: false, reachable: null })
  },
}))
