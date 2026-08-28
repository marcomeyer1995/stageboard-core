import { create } from 'zustand'
import { randomId } from '../lib/id'
import type { Setlist, SetlistEntry } from 'shared-types'
import {
  getAllSetlists,
  getSetlistsDb,
  putSetlist,
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
function toSetlist(doc: SetlistDoc): Setlist {
  const raw = doc as unknown as {
    entries?: SetlistEntry[]
    songIds?: string[]
    createdAt?: number
  }
  const entries: SetlistEntry[] =
    raw.entries ?? (raw.songIds ?? []).map((songId) => ({ id: randomId(), songId, variantId: null }))
  return { id: doc.id, name: doc.name, entries, createdAt: raw.createdAt ?? 0 }
}

interface SetlistsState {
  setlists: Setlist[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  saveSetlist: (setlist: Setlist) => Promise<void>
  duplicateSetlist: (id: string, newName: string) => Promise<Setlist | null>
}

let changesHandle: PouchDB.Core.Changes<Setlist> | null = null

async function refresh(set: (partial: Partial<SetlistsState>) => void) {
  const docs = await getAllSetlists()
  set({ setlists: docs.map(toSetlist) })
}

export const useSetlistsStore = create<SetlistsState>((set, get) => ({
  setlists: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchSetlistsWorkspace(workspaceId)
    set({ setlists: [], loaded: false })

    await refresh(set)
    set({ loaded: true })

    changesHandle = getSetlistsDb().changes({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
  saveSetlist: async (setlist) => {
    await putSetlist(setlist)
  },
  duplicateSetlist: async (id, newName) => {
    const source = get().setlists.find((setlist) => setlist.id === id)
    if (!source) return null
    const copy: Setlist = {
      id: randomId(),
      name: newName,
      entries: source.entries.map((entry) => ({ ...entry, id: randomId() })),
      createdAt: Date.now(),
    }
    await putSetlist(copy)
    return copy
  },
}))
