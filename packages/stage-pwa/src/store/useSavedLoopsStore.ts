import { coalesced } from '../lib/coalesced'
import { create } from 'zustand'
import type { LocalChangesHandle } from '../lib/localChanges'
import type { SavedLoop } from '../lib/savedLoops'
import { getAllSavedLoops, putSavedLoop, removeSavedLoop, savedLoopsChanges, switchSavedLoopsWorkspace } from '../lib/savedLoopsDb'

interface SavedLoopsState {
  loops: SavedLoop[]
  init: (workspaceId: string) => Promise<void>
  save: (loop: SavedLoop) => Promise<void>
  remove: (id: string) => Promise<void>
}

let changesHandle: LocalChangesHandle<SavedLoop> | null = null

async function refresh(set: (partial: Partial<SavedLoopsState>) => void) {
  set({
    loops: (await getAllSavedLoops())
      .map(({ id, variantId, name, startMs, endMs, snap, startPercent, trainerEnabled, targetPercent, stepPercent }) => ({
        id,
        variantId,
        name,
        startMs,
        endMs,
        snap,
        startPercent,
        trainerEnabled,
        targetPercent,
        stepPercent,
      }))
      .sort((a, b) => a.startMs - b.startMs || a.name.localeCompare(b.name)),
  })
}

/** The band's saved practice loops (#683), for every variant - the widget filters by variant. */
export const useSavedLoopsStore = create<SavedLoopsState>((set) => ({
  loops: [],
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchSavedLoopsWorkspace(workspaceId)
    set({ loops: [] })
    await refresh(set)
    changesHandle = savedLoopsChanges()
    changesHandle.on('change', coalesced(() => refresh(set)))
  },
  save: async (loop) => {
    await putSavedLoop(loop)
  },
  remove: async (id) => {
    await removeSavedLoop(id)
  },
}))
