import { coalesced } from '../lib/coalesced'
import { create } from 'zustand'
import type { LocalChangesHandle } from '../lib/localChanges'
import type { Switch, SwitchState } from '../lib/switches'
import { getAllSwitches, putSwitch, removeSwitch, switchesChanges, switchSwitchesWorkspace } from '../lib/switchesDb'

interface SwitchesState {
  switches: Switch[]
  /** Each switch's state on this device (docs/23 §11.5 - band-wide in the next step). */
  states: Record<string, SwitchState>
  init: (workspaceId: string) => Promise<void>
  save: (sw: Switch) => Promise<void>
  remove: (id: string) => Promise<void>
  setState: (id: string, state: SwitchState) => void
}

let changesHandle: LocalChangesHandle<Switch> | null = null

async function refresh(set: (partial: Partial<SwitchesState>) => void) {
  set({ switches: (await getAllSwitches()).map(({ id, name, color, behavior }) => ({ id, name, color, behavior })).sort((a, b) => a.name.localeCompare(b.name)) })
}

/** The band's switches and their state (docs/23 §11). */
export const useSwitchesStore = create<SwitchesState>((set) => ({
  switches: [],
  states: {},
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchSwitchesWorkspace(workspaceId)
    set({ switches: [], states: {} })
    await refresh(set)
    changesHandle = switchesChanges()
    changesHandle.on('change', coalesced(() => refresh(set)))
  },
  save: async (sw) => {
    await putSwitch(sw)
  },
  remove: async (id) => {
    await removeSwitch(id)
  },
  setState: (id, state) => set((current) => ({ states: { ...current.states, [id]: state } })),
}))
