import type { HostCapabilities } from 'shared-types'
import { chooseHostForJob, type HostCandidate } from './jobChoice'

/**
 * Who does a piece of work (#964, Marco 2026-11-23: "first myself; and only when that is not possible, or somewhere else is faster, hand it on"):
 *
 * 1. **This device itself**, when it can (it has what the add-on needs - on Android the add-on's helper app).
 * 2. A **heavy** job leaves the device only for a host that is clearly stronger (`FASTER_BY`): a laptop for stem separation, not a tablet for a tablet.
 * 3. A device that cannot uses the **host it is on**, when that host can; else another host of the band that can - the strongest one for a heavy job.
 * 4. Nobody can: the answer says what is missing.
 *
 * What a host *says* counts (`/host/capabilities`); the power is a coarse, explainable number - cores, and a desktop counts several times a tablet - not a
 * measurement. A job is light unless its add-on marked the method heavy (manifest `load`).
 */
export type Load = 'light' | 'heavy'
export interface Self {
  canRun: boolean
  power: number
}
export type Executor = { where: 'self' } | { where: 'host'; url: string } | { where: 'none'; needs: string | null; note: string | null }

/** A host must be this many times as strong as this device for a heavy job to leave it. */
export const FASTER_BY = 2
/** What a desktop's core is worth against a phone or tablet core (their cores are small and throttle when hot). */
const DESKTOP_FACTOR = 4

export function powerOf(capabilities: HostCapabilities | null): number {
  if (!capabilities) return 1
  const cores = capabilities.cpuCores && capabilities.cpuCores > 0 ? capabilities.cpuCores : 4
  return cores * (capabilities.kind === 'desktop' ? DESKTOP_FACTOR : 1)
}

const entryOf = (capabilities: HostCapabilities, job: string) => (job.startsWith('plugin:') ? capabilities.plugins.find((p) => p.id === job.slice(7)) : capabilities.jobs.find((j) => j.id === job))
const canDo = (host: HostCandidate | null, job: string): boolean => !!host && (host.capabilities === null || entryOf(host.capabilities, job)?.available === true)

export function chooseExecutor(args: { job: string; load: Load; self: Self; current: HostCandidate | null; others: readonly HostCandidate[] }): Executor {
  const { job, load, self, current, others } = args
  const hosts = [...(current ? [current] : []), ...others]
  const capable = hosts.filter((h) => canDo(h, job))
  if (self.canRun) {
    if (load === 'light') return { where: 'self' }
    const stronger = capable.filter((h) => powerOf(h.capabilities) >= self.power * FASTER_BY).sort((a, b) => powerOf(b.capabilities) - powerOf(a.capabilities))[0]
    return stronger ? { where: 'host', url: stronger.url } : { where: 'self' }
  }
  if (load === 'heavy' && capable.length > 1) {
    const strongest = [...capable].sort((a, b) => powerOf(b.capabilities) - powerOf(a.capabilities))[0]!
    return { where: 'host', url: strongest.url }
  }
  const choice = chooseHostForJob(job, current, others)
  return choice.url !== null ? { where: 'host', url: choice.url } : { where: 'none', needs: choice.needs, note: choice.note }
}
