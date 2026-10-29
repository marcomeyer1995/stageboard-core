import { coalesced } from '../lib/coalesced'
import type { LocalChangesHandle } from '../lib/localChanges'
import { create } from 'zustand'
import { randomId } from '../lib/id'
import { ShowLogEventSchema, type ShowLogEvent } from 'shared-types'
import {
  deleteShowEvents,
  getAllShowLogEvents,
  getAllShowProtections,
  putShowLogEvent,
  putShowProtection,
  removeShowProtection,
  showLogChanges,
  showProtectionChanges,
  switchShowLogWorkspace,
  switchShowProtectionWorkspace,
  type ShowLogEventDoc,
} from '../lib/showLogDb'

// Re-parsing (rather than listing fields by hand like most other toX mappers in this
// codebase) matters more here: ShowLogEvent is a discriminated union, so a hand-written
// mapper would need per-variant field lists and silently drop a field the next time a
// variant gains one. Zod strips PouchDB's _id/_rev for us in the same call.
//
// safeParse, not parse: a single malformed historical document (e.g. a pre-fix activeMs
// that isn't an integer - see showLogTracking.ts's finalizeSongPlay) must not crash the
// whole app on load. ShowLog is an append-only replicated event log shared across every
// device in the workspace, so "just fix the one bad document" isn't a real option the way
// it might be for local-only state - graceful degradation (CLAUDE.md) means dropping that
// one event from the timeline, not taking the entire session down with it.
function toShowLogEvent(doc: ShowLogEventDoc): ShowLogEvent | null {
  const parsed = ShowLogEventSchema.safeParse(doc)
  if (parsed.success) return parsed.data
  // Events written with fractional timestamps (server-clock values, before the rounding fix,
  // 2026-10-05) are otherwise fine - read them with the numbers rounded instead of dropping them.
  const rounded = ShowLogEventSchema.safeParse(roundTimes(doc))
  if (rounded.success) return rounded.data
  console.error('Dropping malformed ShowLog event', doc, parsed.error)
  return null
}

const TIME_FIELDS = ['at', 'endedAt', 'activeMs'] as const

function roundTimes(doc: ShowLogEventDoc): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...doc }
  for (const field of TIME_FIELDS) {
    if (typeof copy[field] === 'number') copy[field] = Math.round(copy[field] as number)
  }
  return copy
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
  /** Shows kept from deletion, band-wide (#610). */
  protectedShowIds: string[]
  setProtected: (showId: string, on: boolean, byProfileId: string | null) => Promise<void>
  /** Deletes these shows with all their events - protected ones are skipped. Returns how many
   * shows were deleted. */
  deleteShows: (showIds: readonly string[]) => Promise<number>
}

let changesHandle: LocalChangesHandle<ShowLogEvent> | null = null
let protectionHandle: { cancel: () => void } | null = null

async function refreshProtections(set: (partial: Partial<ShowLogState>) => void) {
  const docs = await getAllShowProtections()
  set({ protectedShowIds: docs.map((doc) => doc.id) })
}

async function refresh(set: (partial: Partial<ShowLogState>) => void) {
  const docs = await getAllShowLogEvents()
  const events = docs
    .map(toShowLogEvent)
    .filter((event): event is ShowLogEvent => event !== null)
    .sort((a, b) => a.at - b.at)
  set({ events })
}

export const useShowLogStore = create<ShowLogState>((set, get) => ({
  events: [],
  loaded: false,
  protectedShowIds: [],
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    protectionHandle?.cancel()
    protectionHandle = null
    switchShowLogWorkspace(workspaceId)
    switchShowProtectionWorkspace(workspaceId)
    set({ events: [], loaded: false, protectedShowIds: [] })

    await Promise.all([refresh(set), refreshProtections(set)])
    set({ loaded: true })

    changesHandle = showLogChanges()
    changesHandle.on('change', coalesced(() => refresh(set)))
    const protections = showProtectionChanges()
    protections.on('change', coalesced(() => refreshProtections(set)))
    protectionHandle = protections
  },
  setProtected: async (showId, on, byProfileId) => {
    if (on) await putShowProtection({ id: showId, protectedAt: Date.now(), byProfileId })
    else await removeShowProtection(showId)
  },
  deleteShows: async (showIds) => {
    const protectedIds = new Set(get().protectedShowIds)
    const deletable = showIds.filter((showId) => !protectedIds.has(showId))
    if (deletable.length === 0) return 0
    await deleteShowEvents(deletable)
    return deletable.length
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
