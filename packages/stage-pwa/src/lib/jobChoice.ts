import type { HostCapabilities } from 'shared-types'

/**
 * Which host does a job (#962): the one the device is on, when it can; else another host of the band that says it can. Only
 * what a host *says* counts - an older host that says nothing is asked as before (it answers for itself), and a job no listed
 * host can do is not sent anywhere: the person is told what is missing instead of getting a 501 after a wait.
 */
export interface HostCandidate {
  url: string
  /** null: the host did not answer, or is older than `/host/capabilities`. */
  capabilities: HostCapabilities | null
}

export type JobHostChoice = { url: string } | { url: null; needs: string | null; note: string | null }

const entryOf = (capabilities: HostCapabilities, job: string) => (job.startsWith('plugin:') ? capabilities.plugins.find((p) => p.id === job.slice(7)) : capabilities.jobs.find((j) => j.id === job))

export function chooseHostForJob(job: string, current: HostCandidate | null, others: readonly HostCandidate[]): JobHostChoice {
  // A host that does not say (older, unreachable) is asked as before.
  if (current && current.capabilities === null) return { url: current.url }
  if (current && entryOf(current.capabilities!, job)?.available) return { url: current.url }
  const capable = others.find((host) => host.capabilities && entryOf(host.capabilities, job)?.available)
  if (capable) return { url: capable.url }
  const entry = current?.capabilities ? entryOf(current.capabilities, job) : undefined
  const fallback = others.map((host) => (host.capabilities ? entryOf(host.capabilities, job) : undefined)).find((e) => e)
  const said = entry ?? fallback
  return { url: null, needs: said?.needs ?? null, note: said?.note ?? null }
}
