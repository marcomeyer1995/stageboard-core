import { coalesced } from '../lib/coalesced'
import { create } from 'zustand'
import { normalizeEquipment, type StageEquipment, type StageSetup } from 'shared-types'
import type { LocalChangesHandle } from '../lib/localChanges'
import { stageEquipmentDb, stageFrontDb, stageSetupsDb } from '../lib/stageMapDb'

interface StageMapState {
  /** The band's equipment and setups - what the Gig goes by. */
  equipment: StageEquipment[]
  setups: StageSetup[]
  /** Own setups and own equipment of every member (#799, docs/31 §0d), kept apart so nothing that
   * decides in the Gig ever reads them: for practising, shown to their owner and the admin
   * (`visibleOwnSetups`). */
  ownSetups: StageSetup[]
  ownEquipment: StageEquipment[]
  /** Device box id → the app on it that came to the front last (mapPlays). */
  front: Record<string, string>
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  saveEquipment: (equipment: StageEquipment) => Promise<void>
  removeEquipment: (id: string) => Promise<void>
  saveSetup: (setup: StageSetup) => Promise<void>
  /** Read-modify-write on the freshly read setup - cables and positions change from several
   * devices at once. */
  updateSetup: (id: string, patch: (current: StageSetup) => StageSetup) => Promise<void>
  removeSetup: (id: string) => Promise<void>
  /** This app came to the front on device box `boxId`. */
  claimFront: (boxId: string, appId: string) => Promise<void>
}

let handles: LocalChangesHandle<unknown>[] = []

async function refresh(set: (partial: Partial<StageMapState>) => void) {
  const [equipment, setups, front] = await Promise.all([stageEquipmentDb.getAll(), stageSetupsDb.getAll(), stageFrontDb.getAll()])
  // Read the new way (#739: pins, container parts) - the documents stay as the band wrote them.
  const all = equipment.map(normalizeEquipment)
  const sorted = setups.sort((a, b) => a.name.localeCompare(b.name))
  set({
    equipment: all.filter((e) => e.owner === undefined),
    ownEquipment: all.filter((e) => e.owner !== undefined),
    setups: sorted.filter((s) => s.owner === undefined),
    ownSetups: sorted.filter((s) => s.owner !== undefined),
    front: Object.fromEntries(front.map((f) => [f.id, f.appId])),
  })
}

/** The stage map (docs/31) - see stageMapDb.ts. Decides who plays Klick, Track and Ansagen in the Gig (mapPlays). */
export const useStageMapStore = create<StageMapState>((set) => ({
  equipment: [],
  setups: [],
  ownSetups: [],
  ownEquipment: [],
  front: {},
  loaded: false,
  init: async (workspaceId) => {
    handles.forEach((h) => h.cancel())
    handles = []
    stageEquipmentDb.switchWorkspace(workspaceId)
    stageSetupsDb.switchWorkspace(workspaceId)
    stageFrontDb.switchWorkspace(workspaceId)
    set({ equipment: [], setups: [], ownSetups: [], ownEquipment: [], front: {}, loaded: false })
    await refresh(set)
    set({ loaded: true })
    const again = coalesced(() => refresh(set))
    handles = [stageEquipmentDb.changes(), stageSetupsDb.changes(), stageFrontDb.changes()] as LocalChangesHandle<unknown>[]
    handles.forEach((h) => h.on('change', again))
  },
  saveEquipment: (equipment) => stageEquipmentDb.put(equipment),
  removeEquipment: (id) => stageEquipmentDb.remove(id),
  saveSetup: (setup) => stageSetupsDb.put(setup),
  // Shown at once, then written: the change feed's refresh came a moment after the write, and a
  // dropped device jumped back to where it was for that moment (2026-11-07). The refresh after the
  // write brings the stored state (another device's change on top, or nothing if it failed).
  updateSetup: async (id, patch) => {
    set((state) => ({ setups: state.setups.map((s) => (s.id === id ? patch(s) : s)), ownSetups: state.ownSetups.map((s) => (s.id === id ? patch(s) : s)) }))
    await stageSetupsDb.update(id, patch)
  },
  removeSetup: (id) => stageSetupsDb.remove(id),
  claimFront: async (boxId, appId) => {
    set((state) => ({ front: { ...state.front, [boxId]: appId } }))
    await stageFrontDb.put({ id: boxId, appId, at: Date.now() })
  },
}))
