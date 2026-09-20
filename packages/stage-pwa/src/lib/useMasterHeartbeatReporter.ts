import { useEffect } from 'react'
import { MASTER_HEARTBEAT_INTERVAL_MS } from 'shared-types'
import { getDeviceId } from './deviceId'
import { reportMasterHeartbeat } from './reportMasterHeartbeat'

/**
 * Mounted once in App.tsx (#32): while this tablet holds the Master-Token, beats every
 * MASTER_HEARTBEAT_INTERVAL_MS so the others can tell a live master from a dead one. Stops the
 * moment the token is lost - no "goodbye" beat, the entry just goes stale, same reasoning as
 * usePresenceReporter.ts.
 */
export function useMasterHeartbeatReporter(workspaceId: string, isMaster: boolean): void {
  useEffect(() => {
    if (!workspaceId || !isMaster) return
    const deviceId = getDeviceId()
    const beat = () => void reportMasterHeartbeat(workspaceId, deviceId)
    beat()
    const interval = setInterval(beat, MASTER_HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [workspaceId, isMaster])
}
