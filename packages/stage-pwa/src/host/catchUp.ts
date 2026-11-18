/**
 * The returned primary's copy of the backup's data (host backup, #947, docs/25 §6e/§6g): while the tablet is
 * out of date it pulls what was written during the takeover from the other host into its own band database,
 * so nothing is lost when it takes the host role back (port of core-backend's `startBandReplication`, #919).
 * One direction only. `local` and `remote` are PouchDB handles - the remote over the other host's pinned
 * connection with the login it issued - so the status mapping can be tried without a network.
 */
export interface CatchUpStatus {
  /** `starting`: nothing yet; `active`: copying; `caught-up`: the copy is current; `behind`: the other host cannot be read, retrying. */
  state: 'starting' | 'active' | 'caught-up' | 'behind'
  docsCopied: number
  /** When the last change came in (ms, this device's clock), or null. */
  lastChangeAt: number | null
}

export interface CatchUp {
  status(): CatchUpStatus
  stop(): void
}

export function startCatchUp(deps: { remote: PouchDB.Database; local: PouchDB.Database; now?: () => number }): CatchUp {
  const now = deps.now ?? Date.now
  const status: CatchUpStatus = { state: 'starting', docsCopied: 0, lastChangeAt: null }
  const handle = deps.local.replicate
    .from(deps.remote, { live: true, retry: true })
    .on('active', () => {
      status.state = 'active'
    })
    .on('change', (info) => {
      status.docsCopied += info.docs_written
      status.lastChangeAt = now()
    })
    // `paused` with an error: PouchDB lost the other host and keeps retrying; without one: caught up.
    .on('paused', (err) => {
      status.state = err ? 'behind' : 'caught-up'
    })
    .on('error', () => {
      status.state = 'behind'
    })
  return { status: () => ({ ...status }), stop: () => handle.cancel() }
}
