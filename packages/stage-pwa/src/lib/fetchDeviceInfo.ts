import { DEFAULT_DEVICE_INFO, type DeviceInfo } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/**
 * One-shot fetch of the Device Ledger's current diagnostic snapshot (deviceInfoStore.ts on the
 * server) - polled on an interval by `useDeviceInfoStore.ts` while `DeviceLedgerView.tsx` is
 * mounted, deliberately *not* a long-lived SSE/EventSource connection like presence's own
 * subscription. Found live, 2026-09-08: this app already holds ~5 other persistent SSE
 * connections open per tab (presence, trigger-stream, discovery, plugin-health x2) against a
 * plain HTTPS/1.1 dev server, already at/near Chrome's 6-connections-per-origin cap - a 6th one
 * here starved one-off requests (including the admin revoke action, exactly while someone had
 * this screen open to use it) of a connection entirely. A plain GET holds nothing open between
 * polls, so it doesn't compete for that same tight budget.
 *
 * Best-effort: no Stage-Server or a failed request both just mean "nothing new this poll" - the
 * caller keeps showing its last-known snapshot rather than flashing to empty.
 */
export async function fetchDeviceInfo(workspaceId: string): Promise<DeviceInfo | null> {
  const base = getStageServerUrl()
  if (!base) return DEFAULT_DEVICE_INFO

  try {
    const response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/device-info`)
    if (!response.ok) return null
    return (await response.json()) as DeviceInfo
  } catch {
    return null
  }
}
