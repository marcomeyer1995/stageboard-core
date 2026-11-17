import { create } from 'zustand'

/**
 * The highest host epoch this device has seen (host backup, #782 part B, docs/25 §6e). A host
 * announcing a lower one is a primary that came back after a takeover and has not handed back: it
 * is out of date. Only recorded here - following the right host is the next step.
 */
interface HostEpochState {
  highestEpoch: number
  /** The host that answered last announced an epoch lower than one already seen. */
  staleHost: boolean
  /** `undefined`: a host built before the epoch existed - never stale, never counted. */
  observe: (epoch: number | undefined) => void
}

export const useHostEpochStore = create<HostEpochState>((set) => ({
  highestEpoch: 0,
  staleHost: false,
  observe: (epoch) =>
    set((state) => {
      if (epoch === undefined) return state
      const highestEpoch = Math.max(state.highestEpoch, epoch)
      const staleHost = epoch < state.highestEpoch
      return highestEpoch === state.highestEpoch && staleHost === state.staleHost ? state : { highestEpoch, staleHost }
    }),
}))
