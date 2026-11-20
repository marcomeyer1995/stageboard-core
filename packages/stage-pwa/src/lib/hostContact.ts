import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { getHostUrl } from './hostUrl'

/**
 * Contact with the host (#782 part A, docs/25 §6e "No host at all"). Every successful clock sample
 * (`/time`, every 2 s while the app runs) is contact; a host that is gone - powered off, its Wi-Fi
 * dropped, the process frozen - answers nothing, and requests to it hang rather than fail. So the
 * signal is the age of the last answer, not an error.
 */

/** Without an answer for this long the host counts as unreachable: the master keeps control
 * locally, every device ends the song by itself. Internal - not shown. Two missed samples and a bit. */
export const HOST_UNREACHABLE_MS = 5_000
/** Without an answer for this long every device shows "Host weg" (Marco, 2026-11-17: 15 s -
 * calmer than the backup takeover's 5-8 s, short Wi-Fi hiccups don't flash red). */
export const HOST_GONE_MS = 15_000

export type HostStatus = 'ok' | 'unreachable' | 'gone'

interface HostContactState {
  /** Date.now() of the last answer from the host, or of the app's start before the first one -
   * a device that never reached a host counts from its start, not as gone at once. */
  lastContactAt: number
  markContact: () => void
}

export const useHostContactStore = create<HostContactState>((set) => ({
  lastContactAt: Date.now(),
  markContact: () => set({ lastContactAt: Date.now() }),
}))

/** Pure: the host's status from the age of its last answer. Without a Host (a local-only
 * band, Solo) there is no host to miss. */
export function hostStatus(hasHostUrl: boolean, lastContactAt: number, now: number): HostStatus {
  if (!hasHostUrl) return 'ok'
  const age = now - lastContactAt
  if (age >= HOST_GONE_MS) return 'gone'
  if (age >= HOST_UNREACHABLE_MS) return 'unreachable'
  return 'ok'
}

/** Checked every second - a host going away is the absence of an event - but a component re-renders
 * only when the status changes (the status bar must stay calm while a song plays, #457). */
export function useHostStatus(): HostStatus {
  const [status, setStatus] = useState<HostStatus>(currentHostStatus)
  useEffect(() => {
    const check = () => setStatus(currentHostStatus())
    const timer = setInterval(check, 1_000)
    const unsubscribe = useHostContactStore.subscribe(check)
    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [])
  return status
}

/** Outside React (stores, drivers that read once): the status right now. */
export function currentHostStatus(): HostStatus {
  return hostStatus(Boolean(getHostUrl()), useHostContactStore.getState().lastContactAt, Date.now())
}
