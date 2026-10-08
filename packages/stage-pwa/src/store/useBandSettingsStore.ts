import { create } from 'zustand'
import type { BandSettings } from 'shared-types'
import type { LocalChangesHandle } from '../lib/localChanges'
import { bandSettingsChanges, getAllBandSettings, putBandSettings, switchBandSettingsWorkspace } from '../lib/bandSettingsDb'

interface BandSettingsState {
  settings: BandSettings
  init: (workspaceId: string) => Promise<void>
  save: (settings: BandSettings) => Promise<void>
}

const EMPTY: BandSettings = { id: 'band' }
let changesHandle: LocalChangesHandle<BandSettings> | null = null

async function refresh(set: (partial: Partial<BandSettingsState>) => void) {
  const docs = await getAllBandSettings()
  set({ settings: docs.find((doc) => doc.id === 'band') ?? EMPTY })
}

/** Settings that apply to the whole band (e.g. what "Geprobt" counts). */
export const useBandSettingsStore = create<BandSettingsState>((set) => ({
  settings: EMPTY,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchBandSettingsWorkspace(workspaceId)
    set({ settings: EMPTY })
    await refresh(set)
    changesHandle = bandSettingsChanges()
    changesHandle.on('change', () => refresh(set))
  },
  save: async (settings) => {
    await putBandSettings(settings)
  },
}))
