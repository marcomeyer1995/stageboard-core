import { useEffect, useRef } from 'react'
import { getServerTime } from './clockSync'
import { useHostStatus } from './hostContact'
import { masterSelfCheck } from './masterTakeover'
import { getHostUrl } from './hostUrl'
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
  const deviceId = useShowStateStore((state) => state.masterIdentity)
  const setSelfCheck = useShowStateStore((state) => state.setSelfCheck)
  const heartbeat = usePresenceStore((state) => state.presence.masterHeartbeat)
  const syncStatus = useSyncStore((state) => deriveSyncStatus(state.streams, state.browserOffline))
  const holdingSince = useRef<number | null>(null)
  const hostUnreachable = useHostStatus() !== 'ok'
  useNow(2_000)

  if (!holdsToken) holdingSince.current = null
  else if (holdingSince.current === null) holdingSince.current = getServerTime()

  const check = holdsToken
    ? masterSelfCheck({ syncStatus, hasHostUrl: Boolean(getHostUrl()), deviceId, heartbeat, now: getServerTime(), holdingSince: holdingSince.current ?? getServerTime(), hostUnreachable })
    : 'ok'
  useEffect(() => {
    setSelfCheck(check)
  }, [check, setSelfCheck])
}
