import { create } from 'zustand'
import type { LeaseStatus } from 'sync-host'

/**
 * The tablet's host module as the UI sees it (host backup, #947, docs/25 §6g): whether the native
 * server runs, who this host is, which epoch it serves and whether the primary's lease is alive.
 */
export interface AndroidHostStatus {
  running: boolean
  /** The address other devices reach this tablet at, e.g. `https://192.168.178.60:8443`. */
  url: string | null
  hostId: string | null
  epoch: number
  /** This tablet is the band's host right now (took over); false while it is the passive backup. */
  active: boolean
  /** A primary that came back to a backup which took over: it copies the backup's data and hands back between songs. */
  outdated: boolean
  /** What the primary's list says this tablet is, or null while the band lists it alone. */
  priority: 1 | 2 | null
  lease: LeaseStatus | null
  error: string | null
}

const EMPTY: AndroidHostStatus = { running: false, url: null, hostId: null, epoch: 1, active: false, outdated: false, priority: null, lease: null, error: null }

export const useAndroidHostStore = create<AndroidHostStatus & { set: (partial: Partial<AndroidHostStatus>) => void; reset: () => void }>((set) => ({
  ...EMPTY,
  set: (partial) => set(partial),
  reset: () => set(EMPTY),
}))
