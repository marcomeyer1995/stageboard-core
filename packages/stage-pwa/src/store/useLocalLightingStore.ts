import { create } from 'zustand'
import type { ShowControlEvent, ShowControlResult } from 'shared-types'

interface LocalLightingState {
  lastCue: string | null
  applyEvent: (event: ShowControlEvent) => ShowControlResult
}

/**
 * Client-side mirror of core-backend's mockLightingPlugin.ts, for when *this* device is the
 * claimed `lighting` target (#10, generalized beyond audio) instead of a Stage-Server plugin -
 * LightingCuesWidget reads `lastCue` from here rather than local component state so the display
 * stays correct regardless of which tablet actually fired the cue.
 */
export const useLocalLightingStore = create<LocalLightingState>((set) => ({
  lastCue: null,
  applyEvent: (event) => {
    set({ lastCue: event.type })
    return { status: 'ok', data: { lastCue: event.type } }
  },
}))
