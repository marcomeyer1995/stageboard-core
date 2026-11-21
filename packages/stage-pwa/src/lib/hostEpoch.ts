import { create } from 'zustand'

/**
 * The highest host epoch this device has seen (host backup, #782 part B, docs/25 §6e). A host
 * announcing a lower one is a primary that came back after a takeover and has not handed back: it
 * is out of date. Only recorded here - following the right host is the next step.
 */
interface HostEpochState {
  highestEpoch: number
  /** The epoch the host this device talks to announced last (0: none yet) - unlike the highest, it
   * follows the host: after a switch it is the new host's. The follower compares the other host to it. */
  currentEpoch: number
  /** What the current host said about being the band host (#938): false = a passive backup. Undefined: it never said. */
  currentActive: boolean | undefined
  /** Who the host this device talks to is (its `hostId` from `/time`; a tablet host's is its device id). Undefined until a host that says it has answered;
   * an older host that does not say keeps the last known one. Hardware that sits on the host is bound to this id (#964), not to a reserved word. */
  currentHostId: string | undefined
  /** The host that answered last announced an epoch lower than one already seen. */
  staleHost: boolean
  /** `undefined`: a host built before the epoch existed - never stale, never counted. */
  observe: (epoch: number | undefined, active?: boolean, hostId?: string) => void
}

export const useHostEpochStore = create<HostEpochState>((set) => ({
  highestEpoch: 0,
  currentEpoch: 0,
  currentActive: undefined,
  currentHostId: undefined,
  staleHost: false,
  observe: (epoch, active, hostId) =>
    set((state) => {
      if (epoch === undefined) return state
      const highestEpoch = Math.max(state.highestEpoch, epoch)
      const staleHost = epoch < state.highestEpoch
      const currentActive = active ?? state.currentActive
      const currentHostId = hostId ?? state.currentHostId
      return highestEpoch === state.highestEpoch && staleHost === state.staleHost && epoch === state.currentEpoch && currentActive === state.currentActive && currentHostId === state.currentHostId
        ? state
        : { highestEpoch, currentEpoch: epoch, currentActive, currentHostId, staleHost }
    }),
}))
