import { coalesced } from '../lib/coalesced'
import { create } from 'zustand'
import type { LocalChangesHandle } from '../lib/localChanges'
import type { OscInputRulesDoc } from '../lib/oscInput'
import { getAllOscInputRules, oscInputRulesChanges, putOscInputRules, switchOscInputRulesWorkspace } from '../lib/oscInputRulesDb'

interface OscInputRulesState {
  docs: OscInputRulesDoc[]
  /** A device is learning a button ("Knöpfe belegen") - it then listens even when not master. */
  learning: boolean
  init: (workspaceId: string) => Promise<void>
  save: (doc: OscInputRulesDoc) => Promise<void>
  setLearning: (learning: boolean) => void
}

let changesHandle: LocalChangesHandle<OscInputRulesDoc> | null = null

async function refresh(set: (partial: Partial<OscInputRulesState>) => void) {
  set({ docs: (await getAllOscInputRules()).map(({ id, rules }) => ({ id, rules })) })
}

/** The button rules of every OSC-Eingang device in the band (#484, oscInput.ts). */
export const useOscInputRulesStore = create<OscInputRulesState>((set) => ({
  docs: [],
  learning: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchOscInputRulesWorkspace(workspaceId)
    set({ docs: [] })
    await refresh(set)
    changesHandle = oscInputRulesChanges()
    changesHandle.on('change', coalesced(() => refresh(set)))
  },
  save: async (doc) => {
    await putOscInputRules(doc)
  },
  setLearning: (learning) => set({ learning }),
}))
