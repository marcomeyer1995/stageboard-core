import type { ShowState } from 'shared-types'
import { create } from 'zustand'
import { getServerTime } from './clockSync'
import { nativeOutputDelayMs } from './nativeOutput'
import { leadNeeded } from './playLead'
import { useShowStateStore } from '../store/useShowStateStore'

/** The lead this device needed at its last fresh song start (reported with the device info). */
export const useLeadNeededStore = create<{ neededMs: number | null; at: number | null }>(() => ({ neededMs: null, at: null }))

function outputDelayMs(): number {
  const native = nativeOutputDelayMs()
  if (native !== null) return native
  // Without the native output (a browser, or switched off) the WebView's own delay is not known
  // reliably (docs/30) - only the way the Play took is counted then.
  return 0
}

/** A fresh song start seen live: playing from before song time 0, a Play time not seen before. */
function freshStart(state: ShowState, before: ShowState | null): boolean {
  return (
    state.playbackStatus === 'playing' &&
    state.playbackStartedAt !== null &&
    state.playbackAccumulatedMs < 0 &&
    (before === null || before.playbackStartedAt !== state.playbackStartedAt)
  )
}

let watching = false

/** Watches every Play from now on (once, main.tsx). The state at app start is not a Play seen live. */
export function startLeadCheck(): void {
  if (watching) return
  watching = true
  let before: ShowState | null = useShowStateStore.getState().state
  useShowStateStore.subscribe((store) => {
    const state = store.state
    if (state !== before && freshStart(state, before)) {
      useLeadNeededStore.setState({ neededMs: leadNeeded(state.playbackStartedAt!, getServerTime(), outputDelayMs()), at: Date.now() })
    }
    before = state
  })
}
