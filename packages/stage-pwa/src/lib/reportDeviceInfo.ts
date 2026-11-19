import type { DeviceInfoReport } from 'shared-types'
import { useSyncStore } from '../store/useSyncStore'
import { getHostUrl } from './hostUrl'

/**
 * POSTs this device's OS/environment/sync-status to the Host (deviceInfoStore.ts),
 * which other tablets pick up via `fetchDeviceInfo.ts`'s poll, and stamps the server-observed
 * `ip`/`lastSeenAt` itself - useDeviceInfoReporter.ts calls this on an interval. Best-effort,
 * same as reportPresence.ts: if the Host is unreachable, nothing here needs recovering -
 * only the Device Ledger misses out on knowing this device is around.
 */
export async function reportDeviceInfo(workspaceId: string, report: DeviceInfoReport): Promise<void> {
  const base = getHostUrl()
  if (!base) return
  // The paired server does not have this band (#897): nothing there to report to.
  if (useSyncStore.getState().notOnServer[workspaceId]) return

  try {
    await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/device-info/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      // Sent while the page hides (#815): keepalive lets it finish after the app went away.
      keepalive: true,
    })
  } catch {
    // Network failure or server down - nothing to recover from here, see doc comment above.
  }
}
