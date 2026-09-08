import type { DeviceInfoReport } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/**
 * POSTs this device's OS/environment/sync-status to the Stage-Server (deviceInfoStore.ts),
 * which other tablets pick up via `fetchDeviceInfo.ts`'s poll, and stamps the server-observed
 * `ip`/`lastSeenAt` itself - useDeviceInfoReporter.ts calls this on an interval. Best-effort,
 * same as reportPresence.ts: if the Stage-Server is unreachable, nothing here needs recovering -
 * only the Device Ledger misses out on knowing this device is around.
 */
export async function reportDeviceInfo(workspaceId: string, report: DeviceInfoReport): Promise<void> {
  const base = getStageServerUrl()
  if (!base) return

  try {
    await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/device-info/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    })
  } catch {
    // Network failure or server down - nothing to recover from here, see doc comment above.
  }
}
