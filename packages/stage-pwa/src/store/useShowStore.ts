import { create } from 'zustand'

export interface QueueSong {
  title: string
  bpm: number
}

const dummyQueue: QueueSong[] = [
  { title: 'Sweet Home Chicago', bpm: 118 },
  { title: 'Sweet Caroline', bpm: 128 },
  { title: 'Mustang Sally', bpm: 128 },
]

interface ShowState {
  queue: QueueSong[]
  activeIndex: number
  currentSong: QueueSong
  nextSong: QueueSong | null
  advanceToNextSong: () => void
}

export const useShowStore = create<ShowState>((set, get) => ({
  queue: dummyQueue,
  activeIndex: 0,
  currentSong: dummyQueue[0],
  nextSong: dummyQueue[1] ?? null,
  advanceToNextSong: () => {
    const { queue, activeIndex } = get()
    const nextIndex = activeIndex + 1
    if (nextIndex >= queue.length) return
    set({
      activeIndex: nextIndex,
      currentSong: queue[nextIndex],
      nextSong: queue[nextIndex + 1] ?? null,
    })
  },
}))
