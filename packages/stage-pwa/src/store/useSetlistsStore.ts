import { create } from 'zustand'
import type { Setlist } from 'shared-types'
import {
  getAllSetlists,
  getSetlistsDb,
  putSetlist,
  switchSetlistsWorkspace,
  type SetlistDoc,
} from '../lib/setlistsDb'

function toSetlist(doc: SetlistDoc): Setlist {
  return { id: doc.id, name: doc.name, songIds: doc.songIds }
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
    const copy: Setlist = { id: crypto.randomUUID(), name: newName, songIds: [...source.songIds] }
    await putSetlist(copy)
    return copy
  },
}))
