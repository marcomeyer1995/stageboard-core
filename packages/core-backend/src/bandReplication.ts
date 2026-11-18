export interface ReplicationStatus {
  /** `starting`: nothing yet; `active`: copying; `caught-up`: the copy is current; `behind`: the primary cannot be read, retrying. */
  state: 'starting' | 'active' | 'caught-up' | 'behind'
  /** Documents copied since this started. */
  docsCopied: number
  /** When the last change came in (ms, this host's clock), or null. */
  lastChangeAt: number | null
}

export interface BandReplication {
  status(): ReplicationStatus
  stop(): void
}

/**
 * The backup's copy of the primary's band database (host backup, #919, docs/25 §6e): a live pull of
 * the primary into this host's own database, retrying by itself when the primary cannot be reached.
 * One direction only - what is written on the backup is not pushed to the primary; the devices bring
 * their own changes to whichever host they talk to. `remote` and `local` are PouchDB handles (the
 * primary over a fingerprint-pinned fetch, this host's own database), so it can be tried on two
 * in-memory databases.
 */
export function startBandReplication(deps: { remote: PouchDB.Database; local: PouchDB.Database; now?: () => number }): BandReplication {
  const now = deps.now ?? Date.now
  const status: ReplicationStatus = { state: 'starting', docsCopied: 0, lastChangeAt: null }
  const handle = deps.local.replicate
    .from(deps.remote, { live: true, retry: true })
    .on('active', () => {
      status.state = 'active'
    })
    .on('change', (info) => {
      status.docsCopied += info.docs_written
      status.lastChangeAt = now()
    })
    // `paused` with an error: PouchDB lost the primary and keeps retrying; without one: caught up.
    .on('paused', (err) => {
      status.state = err ? 'behind' : 'caught-up'
    })
    .on('error', () => {
      status.state = 'behind'
    })
  return {
    status: () => ({ ...status }),
    stop: () => handle.cancel(),
  }
}
