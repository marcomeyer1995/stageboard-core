import { create } from 'zustand'

interface ClockState {
  isRunning: boolean
  startedAt: number | null
  accumulatedMs: number
  start: () => void
  stop: () => void
  reset: () => void
  getElapsedMs: () => number
}

export const useClockStore = create<ClockState>((set, get) => ({
  isRunning: false,
  startedAt: null,
  accumulatedMs: 0,
  start: () => {
    if (get().isRunning) return
    set({ isRunning: true, startedAt: Date.now() })
  },
  stop: () => {
    const { isRunning, startedAt, accumulatedMs } = get()
    if (!isRunning || startedAt === null) return
    set({
      isRunning: false,
      startedAt: null,
      accumulatedMs: accumulatedMs + (Date.now() - startedAt),
    })
  },
  reset: () => {
    const { isRunning } = get()
    set({ accumulatedMs: 0, startedAt: isRunning ? Date.now() : null })
  },
  getElapsedMs: () => {
    const { isRunning, startedAt, accumulatedMs } = get()
    if (!isRunning || startedAt === null) return accumulatedMs
    return accumulatedMs + (Date.now() - startedAt)
  },
}))
