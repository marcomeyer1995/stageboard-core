import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { TIMELINE_LANES, type TimelineLane } from '../lib/timeline'

interface TimelineLanesState {
  /** Lanes collapsed on this device - e.g. the drummer's tablet without lyrics. */
  hidden: TimelineLane[]
  /** Shows or hides a lane; the last visible lane can't be hidden. */
  toggle: (lane: TimelineLane) => void
}

/** Which timeline lanes this device shows (#328) - a per-device view setting, not part of the song. */
export const useTimelineLanesStore = create<TimelineLanesState>()(
  persist(
    (set, get) => ({
      hidden: [],
      toggle: (lane) => {
        const hidden = get().hidden
        if (hidden.includes(lane)) set({ hidden: hidden.filter((l) => l !== lane) })
        else if (hidden.length < TIMELINE_LANES.length - 1) set({ hidden: [...hidden, lane] })
      },
    }),
    { name: 'stageboard-timeline-lanes' },
  ),
)
