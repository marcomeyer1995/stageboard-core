import { useEffect } from 'react'
import { deriveSyncStatus, useSyncStore } from '../store/useSyncStore'
import { detectEnvironment } from './detectEnvironment'
import { getDeviceId } from './deviceId'
import { guessDeviceName } from './guessDeviceName'
import { reportDeviceInfo } from './reportDeviceInfo'

/** Comfortably inside DEVICE_INFO_TIMEOUT_MS (shared-types), same margin usePresenceReporter.ts
 * keeps against PRESENCE_TIMEOUT_MS. */
const REPORT_INTERVAL_MS = 10_000

/**
 * Mounted once in App.tsx, same shape as usePresenceReporter.ts - but deliberately *not* the
 * same gating. Presence only reports while a real profile is active (its own doc comment: a
 * device with no profile chosen "shouldn't show this device as anyone in particular"); this
 * reports whenever a workspace is active at all, because a device with no profile chosen yet is
 * still exactly the kind of thing the Device Ledger (DeviceLedgerView.tsx, Marco's explicit
 * request) needs to show - "the app is open on this tablet but nobody's picked a profile on it"
 * is itself a useful debugging signal, not a state to hide.
 *
 * No explicit "I'm leaving" report on stop - same reasoning as presence: an entry just goes
 * stale and times out (DEVICE_INFO_TIMEOUT_MS), robust to a tab closing or a tablet losing
 * power.
 */
export function useDeviceInfoReporter(workspaceId: string): void {
  useEffect(() => {
    if (!workspaceId) return
    const deviceId = getDeviceId()
    const report = () =>
      void reportDeviceInfo(workspaceId, {
        deviceId,
        os: guessDeviceName(),
        environment: detectEnvironment(),
        syncStatus: deriveSyncStatus(useSyncStore.getState().streams),
      })
    report()
    const interval = setInterval(report, REPORT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [workspaceId])
}
