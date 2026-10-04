import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface TimelineSnapState {
  /** Dragged elements snap: bar lines to drum hits, lyric lines and cues to beats. */
  snapping: boolean
  setSnapping: (snapping: boolean) => void
}

/** The timeline's "Einrasten" switch (#332) - a per-device view setting, on by default. */
export const useTimelineSnapStore = create<TimelineSnapState>()(
  persist(
    (set) => ({
      snapping: true,
      setSnapping: (snapping) => set({ snapping }),
    }),
    { name: 'stageboard-timeline-snapping' },
  ),
)
