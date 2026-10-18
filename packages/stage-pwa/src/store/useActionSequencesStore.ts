import { create } from 'zustand'
import type { ActionSequence } from '../lib/actions'
import {
  actionSequencesChanges,
  getAllActionSequences,
  putActionSequence,
  removeActionSequence,
  switchActionSequencesWorkspace,
} from '../lib/actionSequencesDb'
import type { LocalChangesHandle } from '../lib/localChanges'

interface ActionSequencesState {
  sequences: ActionSequence[]
  init: (workspaceId: string) => Promise<void>
  save: (sequence: ActionSequence) => Promise<void>
  remove: (id: string) => Promise<void>
}

let changesHandle: LocalChangesHandle<ActionSequence> | null = null

async function refresh(set: (partial: Partial<ActionSequencesState>) => void) {
  set({ sequences: (await getAllActionSequences()).map(({ id, name, steps }) => ({ id, name, steps })).sort((a, b) => a.name.localeCompare(b.name)) })
}

/** The band's sequences of actions ("Abläufe", docs/23 §3). */
export const useActionSequencesStore = create<ActionSequencesState>((set) => ({
  sequences: [],
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchActionSequencesWorkspace(workspaceId)
    set({ sequences: [] })
    await refresh(set)
    changesHandle = actionSequencesChanges()
    changesHandle.on('change', () => refresh(set))
  },
  save: async (sequence) => {
    await putActionSequence(sequence)
  },
  remove: async (id) => {
    await removeActionSequence(id)
  },
}))
