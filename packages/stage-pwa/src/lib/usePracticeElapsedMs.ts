import { useEffect, useState } from 'react'
import { computeActiveMs } from './playbackTransport'
import { DEFAULT_PRACTICE_STATE, practiceTransportOf, usePracticeStateStore } from '../store/usePracticeStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/** Practice mode's counterpart to usePlaybackElapsedMs.ts - same tick/compute logic, just off
 * the local practice state instead of synced ShowState, and plain Date.now() rather than
 * clockSync.ts's getServerTime() (there's only ever one device involved, nothing to
 * cross-tablet-synchronize). Returns null while stopped, same "nothing to show" contract.
 * A section jump (#479) continues the clock at its target, the loop trainer's speed (#683) is the
 * transport's `rate`. */
/** The same value, read once without subscribing - for a timer that must not re-render (#400 review). */
export function practiceElapsedMsNow(workspaceId: string): number | null {
  const state = usePracticeStateStore.getState().byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE
  if (state.playbackStatus === 'stopped') return null
  return computeActiveMs(practiceTransportOf(state), Date.now())
}

export function usePracticeElapsedMs(): number | null {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const state = usePracticeStateStore((s) => s.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE)
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (state.playbackStatus !== 'playing') return
    let frame: number
    const tick = () => {
      forceTick((n) => n + 1)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [state.playbackStatus])

  if (state.playbackStatus === 'stopped') return null
  return computeActiveMs(practiceTransportOf(state), Date.now())
}
