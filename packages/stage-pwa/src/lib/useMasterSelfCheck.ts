import { useEffect, useRef } from 'react'
import { getServerTime } from './clockSync'
import { masterSelfCheck } from './masterTakeover'
import { getStageServerUrl } from './stageServer'
import { useNow } from './useNow'
import { usePresenceStore } from '../store/usePresenceStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { deriveSyncStatus, useSyncStore } from '../store/useSyncStore'

/**
 * Mounted once in App.tsx (#378, option B): keeps the token holder's self-check current - see
 * masterSelfCheck. Re-evaluated on a timer, since a heartbeat going stale is the absence of an
 * event.
 */
export function useMasterSelfCheck(): void {
  const holdsToken = useShowStateStore((state) => state.holdsToken)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const setSelfCheck = useShowStateStore((state) => state.setSelfCheck)
  const heartbeat = usePresenceStore((state) => state.presence.masterHeartbeat)
  const syncStatus = useSyncStore((state) => deriveSyncStatus(state.streams, state.browserOffline))
  const holdingSince = useRef<number | null>(null)
  useNow(2_000)

  if (!holdsToken) holdingSince.current = null
  else if (holdingSince.current === null) holdingSince.current = getServerTime()

  const check = holdsToken
    ? masterSelfCheck({ syncStatus, hasStageServer: Boolean(getStageServerUrl()), deviceId, heartbeat, now: getServerTime(), holdingSince: holdingSince.current ?? getServerTime() })
    : 'ok'
  useEffect(() => {
    setSelfCheck(check)
  }, [check, setSelfCheck])
}
