import { useEffect } from 'react'
import { getDeviceId } from './deviceId'
import { reportPresence } from './reportPresence'

/** Comfortably inside PRESENCE_TIMEOUT_MS (shared-types), so a device that's actually still
 * around never looks stale to anyone else. */
const REPORT_INTERVAL_MS = 10_000

/**
 * Mounted once in App.tsx, same shape as useClockSync. Periodically tells the Stage-Server
 * "this device is currently signed in as this profile" (reportPresence.ts) while both a
 * workspace and a real profile are active - `BandManagementView.tsx`'s presence indicators
 * are built entirely from these reports (`usePresenceStore.ts`, the other side).
 *
 * Stops (no more reports) the moment either becomes unset - switching to "Ohne Profil"
 * (`activeProfileId` becomes `''`, falsy) or losing the active workspace. No explicit
 * "I'm leaving" report on stop: existing entries just go stale and time out on their own
 * (`PRESENCE_TIMEOUT_MS`), same as PluginHealth - simpler, and robust to a tab just closing
 * or a tablet losing power, neither of which could fire a clean "goodbye" request anyway.
 */
export function usePresenceReporter(workspaceId: string, profileId: string | undefined): void {
  useEffect(() => {
    if (!workspaceId || !profileId) return
    const deviceId = getDeviceId()
    const report = () => void reportPresence(workspaceId, deviceId, profileId)
    report()
    const interval = setInterval(report, REPORT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [workspaceId, profileId])
}
