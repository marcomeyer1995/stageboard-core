import { coalesced } from '../lib/coalesced'
import { create } from 'zustand'
import type { StageEquipment, StageSetup } from 'shared-types'
import type { LocalChangesHandle } from '../lib/localChanges'
import { stageEquipmentDb, stageSetupsDb } from '../lib/stageMapDb'

interface StageMapState {
  equipment: StageEquipment[]
  setups: StageSetup[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  saveEquipment: (equipment: StageEquipment) => Promise<void>
  removeEquipment: (id: string) => Promise<void>
  saveSetup: (setup: StageSetup) => Promise<void>
  /** Read-modify-write on the freshly read setup - cables and positions change from several
   * devices at once. */
  updateSetup: (id: string, patch: (current: StageSetup) => StageSetup) => Promise<void>
  removeSetup: (id: string) => Promise<void>
}

let handles: LocalChangesHandle<StageEquipment | StageSetup>[] = []

async function refresh(set: (partial: Partial<StageMapState>) => void) {
  const [equipment, setups] = await Promise.all([stageEquipmentDb.getAll(), stageSetupsDb.getAll()])
  set({ equipment, setups: setups.sort((a, b) => a.name.localeCompare(b.name)) })
}

/** The stage map (docs/31) - see stageMapDb.ts. Nothing decides who plays what from it yet. */
export const useStageMapStore = create<StageMapState>((set) => ({
  equipment: [],
  setups: [],
  loaded: false,
  init: async (workspaceId) => {
    handles.forEach((h) => h.cancel())
    handles = []
    stageEquipmentDb.switchWorkspace(workspaceId)
    stageSetupsDb.switchWorkspace(workspaceId)
    set({ equipment: [], setups: [], loaded: false })
    await refresh(set)
    set({ loaded: true })
    const again = coalesced(() => refresh(set))
    handles = [stageEquipmentDb.changes(), stageSetupsDb.changes()] as LocalChangesHandle<StageEquipment | StageSetup>[]
    handles.forEach((h) => h.on('change', again))
  },
  saveEquipment: (equipment) => stageEquipmentDb.put(equipment),
  removeEquipment: (id) => stageEquipmentDb.remove(id),
  saveSetup: (setup) => stageSetupsDb.put(setup),
  // Shown at once, then written: the change feed's refresh came a moment after the write, and a
  // dropped device jumped back to where it was for that moment (2026-11-07). The refresh after the
  // write brings the stored state (another device's change on top, or nothing if it failed).
  updateSetup: async (id, patch) => {
    set((state) => ({ setups: state.setups.map((s) => (s.id === id ? patch(s) : s)) }))
    await stageSetupsDb.update(id, patch)
  },
  removeSetup: (id) => stageSetupsDb.remove(id),
}))
