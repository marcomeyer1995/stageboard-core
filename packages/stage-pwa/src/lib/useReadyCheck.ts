import { computeReadyStatus, type ReadyStatus } from './readyCheck'
import { getServerTime } from './clockSync'
import { useNow } from './useNow'
import { usePresenceStore } from '../store/usePresenceStore'
import { useShowStateStore } from '../store/useShowStateStore'

/** The open Ready Check (#60) and how far along it is - `status` is null while none is open. A
 * device going quiet is the absence of an event, hence the timer. */
export function useReadyCheck(): { checkId: string | null; status: ReadyStatus | null } {
  const checkId = useShowStateStore((state) => state.state.readyCheckId)
  const presence = usePresenceStore((state) => state.presence)
  useNow(5_000)
  return { checkId, status: checkId ? computeReadyStatus(presence, checkId, getServerTime()) : null }
}
