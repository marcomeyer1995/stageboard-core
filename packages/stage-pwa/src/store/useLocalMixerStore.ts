import { create } from 'zustand'
import type { ShowControlEvent, ShowControlResult } from 'shared-types'

interface LocalMixerState {
  volumes: Record<string, number>
  applyEvent: (event: ShowControlEvent) => ShowControlResult
}

/**
 * Client-side mirror of core-backend's mockMixerPlugin.ts, for when *this* device is the claimed
 * `mixer` target (#10, generalized beyond audio) instead of a Stage-Server plugin - IemWidget
 * reads `volumes` from here rather than local component state so the faders stay correct
 * regardless of which tablet actually moved them.
 */
export const useLocalMixerStore = create<LocalMixerState>((set, get) => ({
  volumes: {},
  applyEvent: (event) => {
    if (event.type === 'set_volume') {
      const channel = event.payload?.channel
      const requested = event.payload?.volume
      if (typeof channel === 'string' && typeof requested === 'number') {
        set({ volumes: { ...get().volumes, [channel]: requested } })
      }
    }
    return { status: 'ok', data: { volumes: { ...get().volumes } } }
  },
}))
