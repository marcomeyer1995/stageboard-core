import { create } from 'zustand'

/** The user-facing loop/trainer settings for one song. Percentages, not fractions - that is what
 * the steppers show; lib/loopTrainer.ts converts. */
export interface LoopTrainerConfig {
  startMs: number | null
  endMs: number | null
  /** Tempo of the first (or, with the trainer off, every) pass. */
  startPercent: number
  trainerEnabled: boolean
  targetPercent: number
  stepPercent: number
}

export const DEFAULT_LOOP_CONFIG: LoopTrainerConfig = {
  startMs: null,
  endMs: null,
  startPercent: 100,
  trainerEnabled: false,
  targetPercent: 100,
  stepPercent: 5,
}

interface LoopTrainerStore {
  /** The queue entry the config below belongs to - a loop is tied to one song's timeline, so a
   * different entry sees the defaults (same mechanism as useChordOffsetStore). */
  entryId: string | null
  config: LoopTrainerConfig
  /** Why the last start failed (set by lib/loopTrainer.ts). Whether a loop runs is the practice
   * state's (#683, `trainerLoopOf`). */
  error: string | null
  setConfig: (entryId: string, patch: Partial<LoopTrainerConfig>) => void
  setError: (error: string | null) => void
}

/** This device's rehearsal loop: local, never synced, never persisted - like every other
 * Practice-mode-only choice. */
export const useLoopTrainerStore = create<LoopTrainerStore>((set, get) => ({
  entryId: null,
  config: DEFAULT_LOOP_CONFIG,
  error: null,
  setConfig: (entryId, patch) =>
    set({ entryId, config: { ...(get().entryId === entryId ? get().config : DEFAULT_LOOP_CONFIG), ...patch } }),
  setError: (error) => set({ error }),
}))

export function loopConfigFor(entryId: string | null): LoopTrainerConfig {
  const { entryId: storedId, config } = useLoopTrainerStore.getState()
  return entryId !== null && storedId === entryId ? config : DEFAULT_LOOP_CONFIG
}
