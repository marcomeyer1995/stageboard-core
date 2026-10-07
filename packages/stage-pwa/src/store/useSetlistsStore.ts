import type { LocalChangesHandle } from '../lib/localChanges'
import { create } from 'zustand'
import { randomId } from '../lib/id'
import type { Setlist, SetlistEntry } from 'shared-types'
import {
  getAllSetlists,
  putSetlist,
  removeSetlist,
  setlistsChanges,
  switchSetlistsWorkspace,
  type SetlistDoc,
} from '../lib/setlistsDb'

/**
 * A setlist replicated before per-entry variants existed has `songIds: string[]` and no
 * `entries` at all - PouchDB returns exactly what was stored, unvalidated, so this read-time
 * fallback matters even though the type says `entries` is always present. Synthesizes one
 * entry per song id, defaulting to that song's isDefault variant; the setlist becomes a real
 * `entries` document the next time anything saves it (same lazy-migration spirit as
 * ensureDefaultVariant in songVariantsDb.ts).
 */
/** A stored setlist as the app uses it. Keeps every field of the doc - it used to copy only
 * id/name/entries/createdAt, which silently dropped the Festival-Uhr schedule (targetEndTime,
 * default pause and song length) and the gig date (found 2026-10-07: the date picker "didn't
 * take"). Only PouchDB's own fields and the legacy `songIds` stay behind. */
export function toSetlist(doc: SetlistDoc): Setlist {
  const { _id, _rev, _deleted, _conflicts, songIds, ...rest } = doc as unknown as Setlist & {
    _id?: string
    _rev?: string
    _deleted?: boolean
    _conflicts?: string[]
    songIds?: string[]
  }
  void _id
  void _rev
  void _deleted
  void _conflicts
  const entries: SetlistEntry[] = rest.entries ?? (songIds ?? []).map((songId) => ({ id: randomId(), songId, variantId: null, trackId: null }))
  return { ...rest, id: doc.id, name: doc.name, entries, createdAt: rest.createdAt ?? 0 }
}

interface SetlistsState {
  setlists: Setlist[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  saveSetlist: (setlist: Setlist) => Promise<void>
  /** Copies `source` as given - SetlistDetail passes what is shown, unsaved changes included. */
  duplicateSetlist: (source: Setlist, newName: string) => Promise<Setlist | null>
  remove: (id: string) => Promise<void>
}

let changesHandle: LocalChangesHandle<Setlist> | null = null

async function refresh(set: (partial: Partial<SetlistsState>) => void) {
  const docs = await getAllSetlists()
  set({ setlists: docs.map(toSetlist) })
}

export const useSetlistsStore = create<SetlistsState>((set) => ({
  setlists: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchSetlistsWorkspace(workspaceId)
    set({ setlists: [], loaded: false })

    await refresh(set)
    set({ loaded: true })

    changesHandle = setlistsChanges()
    changesHandle.on('change', () => refresh(set))
  },
  saveSetlist: async (setlist) => {
    await putSetlist(setlist)
  },
  duplicateSetlist: async (source, newName) => {
    // Everything of the source (gig date, Festival-Uhr schedule too) - entries get new ids.
    const copy: Setlist = {
      ...source,
      id: randomId(),
      name: newName,
      entries: source.entries.map((entry) => ({ ...entry, id: randomId() })),
      createdAt: Date.now(),
    }
    await putSetlist(copy)
    return copy
  },
  remove: async (id) => {
    await removeSetlist(id)
  },
}))
