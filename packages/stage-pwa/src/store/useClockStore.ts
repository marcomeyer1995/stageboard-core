import { create } from 'zustand'

interface ClockState {
  isRunning: boolean
  startedAt: number | null
  accumulatedMs: number
  /** Song ms per wall ms - the Timeline's slowed playback (0.5 = half speed). */
  rate: number
  setRate: (rate: number) => void
  start: () => void
  stop: () => void
  reset: () => void
  seek: (ms: number) => void
  getElapsedMs: () => number
}

export const useClockStore = create<ClockState>((set, get) => ({
  isRunning: false,
  startedAt: null,
  accumulatedMs: 0,
  rate: 1,
  setRate: (rate) => {
    const { isRunning } = get()
    set({ accumulatedMs: get().getElapsedMs(), startedAt: isRunning ? Date.now() : null, rate })
  },
  start: () => {
    if (get().isRunning) return
    set({ isRunning: true, startedAt: Date.now() })
  },
  stop: () => {
    const { isRunning, startedAt, accumulatedMs, rate } = get()
    if (!isRunning || startedAt === null) return
    set({
      isRunning: false,
      startedAt: null,
      accumulatedMs: accumulatedMs + (Date.now() - startedAt) * rate,
    })
  },
  reset: () => {
    const { isRunning } = get()
    set({ accumulatedMs: 0, startedAt: isRunning ? Date.now() : null })
  },
  seek: (ms) => {
    const { isRunning } = get()
    set({ accumulatedMs: Math.max(0, ms), startedAt: isRunning ? Date.now() : null })
  },
  getElapsedMs: () => {
    const { isRunning, startedAt, accumulatedMs, rate } = get()
    if (!isRunning || startedAt === null) return accumulatedMs
    return accumulatedMs + (Date.now() - startedAt) * rate
  },
}))
