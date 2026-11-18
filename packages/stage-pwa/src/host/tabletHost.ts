import { createHostLeaseService, type HostLeaseService, type LeaseStatus } from 'sync-host'

/**
 * The tablet's view of the shared host service (host backup, #947, #949): the lease, takeover, handback and
 * invitation logic is `sync-host`'s `createHostLeaseService` - the very code the laptop's Stage-Server runs.
 * What is the tablet's own is small: it serves only when the band's list names it (a tablet that was merely
 * switched on never makes itself the host of a band that lists nobody), and the native server answers the
 * clock with the primary's offset only once it is the host.
 */
export interface TabletHostState {
  hostId: string
  epoch: number
  /** This tablet is the band's host right now and serves it. */
  active: boolean
  /** A primary that has seen a higher epoch than its own: it stays quiet and copies the backup's data. */
  outdated: boolean
  /** What the band's list says this tablet is, or null while it is not listed (or listed alone). */
  priority: 1 | 2 | null
}

export interface TabletHost {
  /** The shared service, for what needs more than the view below (admin takeover, origins, ...). */
  service: HostLeaseService
  state(): TabletHostState
  lease(): LeaseStatus | null
  /** Offset to add to the native clock answer: the primary's, once this tablet has taken over; else none. */
  clockOffsetMs(): number
  /** Band time as the shared service serves it. */
  bandTime(): number
}

export function createTabletHost(deps: Parameters<typeof createHostLeaseService>[0]): TabletHost {
  const service = createHostLeaseService(deps)
  return {
    service,
    state() {
      const priority = service.priority()
      return {
        hostId: deps.selfHostId,
        epoch: service.epoch(),
        active: priority !== null && service.isBandHost(),
        outdated: service.outdated(),
        priority,
      }
    },
    lease: () => service.status(),
    clockOffsetMs: () => (service.isActive() ? (service.clockOffsetMs() ?? 0) : 0),
    bandTime: () => service.bandTime(),
  }
}
