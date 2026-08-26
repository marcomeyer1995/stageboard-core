import { create } from 'zustand'
import { randomId } from '../lib/id'
import { ShowLogEventSchema, type ShowLogEvent } from 'shared-types'
import {
  getAllShowLogEvents,
  getShowLogDb,
  putShowLogEvent,
  switchShowLogWorkspace,
  type ShowLogEventDoc,
} from '../lib/showLogDb'

// Re-parsing (rather than listing fields by hand like most other toX mappers in this
// codebase) matters more here: ShowLogEvent is a discriminated union, so a hand-written
// mapper would need per-variant field lists and silently drop a field the next time a
// variant gains one. Zod strips PouchDB's _id/_rev for us in the same call.
function toShowLogEvent(doc: ShowLogEventDoc): ShowLogEvent {
  return ShowLogEventSchema.parse(doc)
}

/**
 * The most recently started show, purely derived from the replicated event log - not
 * separately-tracked state. Every device (not just whichever one holds the Master-Token
 * and runs useShowLogTracker) needs this to file a note under the right show, so it has
 * to be something every device can compute for itself from data that actually replicates
 * to it, rather than local-only state only the tracker's own tablet would ever set.
 */
export function latestShowId(events: ShowLogEvent[]): string | null {
  let latest: Extract<ShowLogEvent, { type: 'show-started' }> | null = null
  for (const event of events) {
    if (event.type === 'show-started' && (!latest || event.at > latest.at)) latest = event
  }
  return latest?.showId ?? null
}

interface ShowLogState {
  events: ShowLogEvent[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  /** Open to any device, not master-gated - unlike every other event type here. No-ops
   * if no show has started yet. */
  addNote: (text: string, authorProfileId: string | null) => Promise<void>
  /** For the master-gated tracker (useShowLogTracker.ts) to append derived events. */
  append: (event: ShowLogEvent) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<ShowLogEvent> | null = null

async function refresh(set: (partial: Partial<ShowLogState>) => void) {
  const docs = await getAllShowLogEvents()
  set({ events: docs.map(toShowLogEvent).sort((a, b) => a.at - b.at) })
}

export const useShowLogStore = create<ShowLogState>((set, get) => ({
  events: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchShowLogWorkspace(workspaceId)
    set({ events: [], loaded: false })

    await refresh(set)
    set({ loaded: true })

    changesHandle = getShowLogDb().changes({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
  addNote: async (text, authorProfileId) => {
    const showId = latestShowId(get().events)
    if (!showId) return
    await putShowLogEvent({
      id: randomId(),
      showId,
      type: 'note',
      at: Date.now(),
      text,
      authorProfileId,
    })
  },
  append: async (event) => {
    await putShowLogEvent(event)
  },
}))
