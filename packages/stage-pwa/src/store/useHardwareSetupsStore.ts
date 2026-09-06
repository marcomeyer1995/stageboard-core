import { create } from 'zustand'
import type { HardwareSetup } from 'shared-types'
import {
  getAllHardwareSetups,
  hardwareSetupsChanges,
  putHardwareSetup,
  removeHardwareSetup,
  switchHardwareSetupsWorkspace,
} from '../lib/hardwareSetupsDb'

interface HardwareSetupsState {
  setups: HardwareSetup[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  save: (setup: HardwareSetup) => Promise<void>
  remove: (id: string) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<HardwareSetup> | null = null

async function refresh(set: (partial: Partial<HardwareSetupsState>) => void) {
  const docs = await getAllHardwareSetups()
  set({ setups: docs })
}

/**
 * Named, switchable rig configurations (#10's HardwareSetup, hardwareSetup.ts) - e.g.
 * "Festival" vs. "Acoustic Solo". Created/edited via SystemView's "Hardware" tab
 * (HardwareSetupManager.tsx); HardwareSetupPicker.tsx (AppMenu.tsx) only lets Master choose
 * which already-existing one is active.
 */
export const useHardwareSetupsStore = create<HardwareSetupsState>((set) => ({
  setups: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchHardwareSetupsWorkspace(workspaceId)
    set({ setups: [], loaded: false })

    await refresh(set)
    set({ loaded: true })

    changesHandle = hardwareSetupsChanges({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
  save: async (setup) => {
    await putHardwareSetup(setup)
  },
  remove: async (id) => {
    await removeHardwareSetup(id)
  },
}))
