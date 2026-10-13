import { create } from 'zustand'
import type { LatencyProfileDoc } from 'shared-types'
import type { LocalChangesHandle } from '../lib/localChanges'
import {
  getAllLatencyProfiles,
  latencyProfileChanges,
  putLatencyProfile,
  removeLatencyProfile,
  switchLatencyProfileWorkspace,
} from '../lib/latencyProfileDb'

interface LatencyProfilesState {
  profiles: LatencyProfileDoc[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  save: (profile: LatencyProfileDoc) => Promise<void>
  remove: (id: string) => Promise<void>
}

let changesHandle: LocalChangesHandle<LatencyProfileDoc> | null = null

async function refresh(set: (partial: Partial<LatencyProfilesState>) => void) {
  set({ profiles: await getAllLatencyProfiles() })
}

/** Measured / entered latency per output path (docs/21 §3, #491) - see latencyProfileDb.ts. */
export const useLatencyProfilesStore = create<LatencyProfilesState>((set) => ({
  profiles: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchLatencyProfileWorkspace(workspaceId)
    set({ profiles: [], loaded: false })
    await refresh(set)
    set({ loaded: true })
    changesHandle = latencyProfileChanges()
    changesHandle.on('change', () => refresh(set))
  },
  save: async (profile) => {
    await putLatencyProfile(profile)
  },
  remove: async (id) => {
    await removeLatencyProfile(id)
  },
}))
