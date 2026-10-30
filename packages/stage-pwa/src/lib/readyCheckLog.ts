import { computeReadyStatus } from './readyCheck'
import { getServerTime } from './clockSync'
import { recordShowEvent } from './showLogRecord'
import { usePresenceStore } from '../store/usePresenceStore'
import { useProfilesStore } from '../store/useProfilesStore'

/**
 * A Ready Check into the Nachbericht (#673): when it started, and when it ended who had answered and
 * who was still missing. Called by the store (loaded lazily there - the store and the show log
 * know each other otherwise).
 */
export function recordReadyCheck(action: 'started' | 'ended', checkId: string): void {
  if (action === 'started') {
    recordShowEvent({ type: 'ready-check', action })
    return
  }
  const presence = usePresenceStore.getState().presence
  const status = computeReadyStatus(presence, checkId, getServerTime())
  const profiles = useProfilesStore.getState().profiles
  const name = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? id
  const answered = presence.readyCheck?.checkId === checkId ? presence.readyCheck.readyProfileIds : []
  recordShowEvent({ type: 'ready-check', action, ready: answered.map(name), missing: status.missingProfileIds.map(name) })
}
