import { useEffect } from 'react'
import { clampRate, type LoopSpeedConfig } from './loopSchedule'
import { getLoopPlaybackState, startLoopEngine, stopLoopEngine } from './loopTrainerEngine'
import { practiceBeginLoop, practiceEndLoop, practiceLoopContext, usePracticeQueue } from './practiceQueue'
import { getTrack } from './songVariantsDb'
import { useAppModeStore } from '../store/useAppModeStore'
import { usePracticeStateStore, DEFAULT_PRACTICE_STATE } from '../store/usePracticeStateStore'
import { useLoopTrainerStore, loopConfigFor, type LoopTrainerConfig } from '../store/useLoopTrainerStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/** The trainer's percentages as the engine's rate fractions. With the trainer off the loop just
 * runs at the start tempo. */
export function speedFromConfig(config: LoopTrainerConfig): LoopSpeedConfig {
  const start = clampRate(config.startPercent / 100)
  if (!config.trainerEnabled) return { startRate: start, targetRate: start, step: 0 }
  return { startRate: start, targetRate: clampRate(config.targetPercent / 100), step: config.stepPercent / 100 }
}

/** Starts the rehearsal loop for the current practice entry (Solo Üben only). Needs a user
 * gesture - it is called straight from the Start button. */
export async function startLoopTrainer(): Promise<void> {
  const setActive = useLoopTrainerStore.getState().setActive
  const context = practiceLoopContext()
  if (!context) return setActive(false, 'Kein Track für diesen Song')
  const config = loopConfigFor(context.entryId)
  if (config.startMs === null || config.endMs === null) return setActive(false, 'Bitte Loop-Anfang und -Ende setzen')

  const blob = await getTrack(context.variantId, context.trackId)
  if (!blob) return setActive(false, 'Kein Track gefunden')

  const result = await startLoopEngine({ blob, startMs: config.startMs, endMs: config.endMs, speed: speedFromConfig(config) })
  if (result.status === 'error') return setActive(false, result.message ?? 'Fehler')
  practiceBeginLoop(config.startMs)
  setActive(true)
}

/** Stops the loop and leaves practice paused where the loop was, so Play continues from there. */
export function stopLoopTrainer(): void {
  const state = getLoopPlaybackState()
  stopLoopEngine()
  useLoopTrainerStore.getState().setActive(false)
  if (state) practiceEndLoop(state.positionMs)
}

/**
 * Keeps the loop from outliving what it was started for (mounted once in App.tsx, like the other
 * audio drivers): anything that ends practice playback - Pause/Stop/Next on the transport, another
 * song, switching to Gig mode - must also end the loop's audio, or it would keep sounding under a
 * transport that says it stopped. Those actions already own the transport state, so this only
 * stops the engine and never writes practice state itself.
 */
export function useLoopTrainerDriver(): void {
  const active = useLoopTrainerStore((state) => state.active)
  const loopEntryId = useLoopTrainerStore((state) => state.entryId)
  const mode = useAppModeStore((state) => state.mode)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const playbackStatus = usePracticeStateStore((state) => (state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE).playbackStatus)
  // The queue's current entry, not the raw state field: with no explicit selection the queue falls
  // back to its first entry while `activeEntryId` is still null.
  const currentEntryId = usePracticeQueue().currentEntry?.id ?? null

  const stillValid = mode === 'practice' && playbackStatus === 'playing' && currentEntryId === loopEntryId
  useEffect(() => {
    if (!active || stillValid) return
    stopLoopEngine()
    useLoopTrainerStore.getState().setActive(false)
  }, [active, stillValid])
}
