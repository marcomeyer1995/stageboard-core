/**
 * Whether a tablet host serves a band right now (#962). A band it **founded** is served whatever the lease says - it is the
 * only host of it, there is no primary to wait for. A band it only **joined** (the active band, listed as a host) is served
 * while the lease makes it the band host. With no band named (the audio routes) it serves when it holds a founded band or is
 * the band host by the lease.
 */
export function createServing(deps: { founded: () => ReadonlySet<string>; activeBand: () => string | null; leaseActive: () => boolean }) {
  return (band?: string): boolean => {
    const founded = deps.founded()
    if (band === undefined) return founded.size > 0 || (deps.activeBand() !== null && deps.leaseActive())
    return founded.has(band) || (deps.activeBand() === band && deps.leaseActive())
  }
}
