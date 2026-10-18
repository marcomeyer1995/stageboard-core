import { create } from 'zustand'
import type { LocalChangesHandle } from '../lib/localChanges'
import type { MidiControllerRulesDoc } from '../lib/midiControllerRules'
import {
  getAllMidiControllerRules,
  midiControllerRulesChanges,
  putMidiControllerRules,
  removeMidiControllerRules,
  switchMidiControllerRulesWorkspace,
} from '../lib/midiControllerRulesDb'

interface MidiControllerRulesState {
  docs: MidiControllerRulesDoc[]
  init: (workspaceId: string) => Promise<void>
  save: (doc: MidiControllerRulesDoc) => Promise<void>
  remove: (logicalDeviceId: string) => Promise<void>
}

let changesHandle: LocalChangesHandle<MidiControllerRulesDoc> | null = null

async function refresh(set: (partial: Partial<MidiControllerRulesState>) => void) {
  set({ docs: (await getAllMidiControllerRules()).map(({ id, rules }) => ({ id, rules })) })
}

/** The button rules of every MIDI controller in the band (#547, midiControllerRules.ts). */
export const useMidiControllerRulesStore = create<MidiControllerRulesState>((set) => ({
  docs: [],
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchMidiControllerRulesWorkspace(workspaceId)
    set({ docs: [] })
    await refresh(set)
    changesHandle = midiControllerRulesChanges()
    changesHandle.on('change', () => refresh(set))
  },
  save: async (doc) => {
    await putMidiControllerRules(doc)
  },
  remove: async (logicalDeviceId) => {
    await removeMidiControllerRules(logicalDeviceId)
  },
}))
