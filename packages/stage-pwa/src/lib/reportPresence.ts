import { useSyncStore } from '../store/useSyncStore'
import { getHostUrl } from './hostUrl'

/**
 * POSTs "this device is currently signed in as this profile" to the Host
 * (presenceStore.ts), which relays it to every other tablet over presenceStream.ts -
 * `usePresenceReporter.ts` calls this on an interval. Best-effort, same as
 * reportClientHealth.ts: if the Host is unreachable, nothing here needs recovering -
 * only other tablets miss out on knowing this device is online.
 */
export async function reportPresence(workspaceId: string, deviceId: string, profileId: string): Promise<void> {
  const base = getHostUrl()
  if (!base) return
  // The paired server does not have this band (#897): nothing there to report to.
  if (useSyncStore.getState().notOnServer[workspaceId]) return

  try {
    await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/presence/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, profileId }),
    })
  } catch {
    // Network failure or server down - nothing to recover from here, see doc comment above.
  }
}
