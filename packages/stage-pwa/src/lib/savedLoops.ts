import type { LoopSnap } from './loopSnap'
import type { LoopTrainerConfig } from '../store/useLoopTrainerStore'

/**
 * A practice loop kept with a song variant (#683 step 3, Marco 2026-11-03): range, grid and
 * speed under a name like "Solo". Band-wide - everyone sees and can recall it - and per variant,
 * since each variant keeps its own timings. Editing one changes it for everyone; there are no
 * personal copies.
 */
export interface SavedLoop {
  id: string
  variantId: string
  name: string
  startMs: number
  endMs: number
  snap: LoopSnap
  startPercent: number
  trainerEnabled: boolean
  targetPercent: number
  stepPercent: number
}

/** The parts of a loop setting a saved loop keeps. */
export function loopSettingsOf(loop: SavedLoop): Omit<LoopTrainerConfig, 'savedLoopId'> {
  const { startMs, endMs, snap, startPercent, trainerEnabled, targetPercent, stepPercent } = loop
  return { startMs, endMs, snap, startPercent, trainerEnabled, targetPercent, stepPercent }
}

/** Whether the widget's settings differ from the saved loop they were loaded from. */
export function loopChanged(settings: LoopTrainerConfig, loop: SavedLoop): boolean {
  const saved = loopSettingsOf(loop)
  return (Object.keys(saved) as (keyof typeof saved)[]).some((key) => settings[key] !== saved[key])
}
