import i18n from '../i18n'
import { clampRate, passRates, type LoopSpeedConfig } from './loopSchedule'
import { prepareStretch } from './mixStretch'
import { practiceBeginTrainerLoop, practiceEndTrainerLoop, practiceLoopContext } from './practiceQueue'
import { getSharedAudioContext } from './sharedAudioContext'
import { DEFAULT_PRACTICE_STATE, usePracticeStateStore, type PracticeState } from '../store/usePracticeStateStore'
import { useLoopTrainerStore, loopConfigFor, type LoopTrainerConfig } from '../store/useLoopTrainerStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * The loop trainer (#61) on the one playback engine (#683): it is Solo Üben's section loop (#479)
 * with its own range and a speed per pass. Track, stems, Mein Mix and click all play it - nothing
 * of its own decodes or plays audio. The speed is the practice transport's `rate`; each pass back
 * to A is a section jump carrying the next pass's speed (sectionJump.ts), and the mix goes through
 * one pitch-keeping stretch while the session is slowed (mixStretch.ts).
 */

/** The trainer's percentages as rate fractions. With the trainer off the loop just runs at the
 * start tempo. */
export function speedFromConfig(config: LoopTrainerConfig): LoopSpeedConfig {
  const start = clampRate(config.startPercent / 100)
  if (!config.trainerEnabled) return { startRate: start, targetRate: start, step: 0 }
  return { startRate: start, targetRate: clampRate(config.targetPercent / 100), step: config.stepPercent / 100 }
}

/** The trainer loop of a practice state - null when none runs (also while a plain section loops). */
export function trainerLoopOf(state: PracticeState): { startMs: number; endMs: number; pass: number; rate: number } | null {
  const loop = state.playbackLoop
  if (!loop?.rates?.length) return null
  return { startMs: loop.startMs, endMs: loop.endMs, pass: loop.pass ?? 0, rate: state.playbackRate ?? 1 }
}

/** The running trainer loop of the active band's practice, re-rendering when it changes. */
export function useTrainerLoop(): ReturnType<typeof trainerLoopOf> {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const loop = usePracticeStateStore((state) => (state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE).playbackLoop)
  const rate = usePracticeStateStore((state) => (state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE).playbackRate)
  return trainerLoopOf({ ...DEFAULT_PRACTICE_STATE, playbackLoop: loop ?? null, ...(rate !== undefined ? { playbackRate: rate } : {}) })
}

/** Starts the loop for the current practice entry (Solo Üben only). Called straight from the Start
 * button - the stretcher's audio needs that gesture. */
export async function startLoopTrainer(): Promise<void> {
  const setError = useLoopTrainerStore.getState().setError
  const context = practiceLoopContext()
  if (!context) return setError(i18n.t('messages:noTrackForSong'))
  const config = loopConfigFor(context.entryId)
  if (config.startMs === null || config.endMs === null || config.endMs <= config.startMs) return setError(i18n.t('messages:setLoop'))
  const rates = passRates(speedFromConfig(config))
  // Loaded before the first slowed note, so the first pass doesn't start unstretched.
  if (rates.some((rate) => rate !== 1)) {
    const ctx = getSharedAudioContext()
    void ctx.resume()
    if (!(await prepareStretch(ctx))) return setError(i18n.t('messages:error'))
  }
  setError(null)
  practiceBeginTrainerLoop(config.startMs, config.endMs, rates)
}

/** Stops the loop and leaves practice paused where it was, so Play continues the song from there
 * at its own tempo. */
export function stopLoopTrainer(): void {
  practiceEndTrainerLoop()
}
