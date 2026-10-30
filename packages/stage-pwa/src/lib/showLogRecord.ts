import type { ShowLogEvent } from 'shared-types'
import { getServerTime } from './clockSync'
import { randomId } from './id'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** An event as its caller knows it - the show, the id and (by default) the time are filled in. */
export type ShowLogInput = DistributiveOmit<ShowLogEvent, 'id' | 'showId' | 'at'> & {
  at?: number
  /** The show it belongs to, when the caller knows it at the moment it happened (null: none) -
   * otherwise the one running when it is written. */
  showId?: string | null
}

/**
 * Writes one event into the running show's Nachbericht (#673): what happened, when and how. Nothing
 * outside a show (no Play or song change yet); a category the band switched off is dropped by the
 * store's append. The time is server time, like every other show event, so the devices' entries
 * line up - taken now, the stores are loaded lazily: widgets and the jump logic call this, and
 * importing the show log's database with them would tie every one of them (and its tests) to it.
 */
export function recordShowEvent(input: ShowLogInput): void {
  const at = Math.round(input.at ?? getServerTime())
  if (input.showId === null) return
  void Promise.all([import('../store/useShowStateStore'), import('../store/useShowLogStore')])
    .then(([showState, showLog]) => {
      const showId = input.showId ?? showState.useShowStateStore.getState().state.currentShowId
      if (!showId) return
      return showLog.useShowLogStore.getState().append({ ...input, id: randomId(), showId, at } as ShowLogEvent)
    })
    .catch(() => undefined)
}
