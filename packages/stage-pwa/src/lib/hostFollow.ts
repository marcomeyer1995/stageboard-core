import { HostTimeAnswerSchema, type BandHostEntry } from 'shared-types'

/**
 * Following the host with the highest epoch (host backup, #916, docs/25 §6e). After a takeover the
 * backup announces a higher epoch; a device moves to it, and never back to a host with a lower or
 * equal one - an equal epoch is no reason to move, so a Wi-Fi hiccup cannot make it flap.
 */

const sameHost = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase()

/** The listed host to move to, or null to stay. `probes`: the epoch each other host announced just
 * now (null: it did not answer or announced none). Only with two listed hosts, one of them the
 * current one. */
export function hostToFollow(
  hosts: readonly BandHostEntry[] | undefined,
  currentUrl: string,
  currentEpoch: number,
  probes: Readonly<Record<string, number | null>>,
): BandHostEntry | null {
  if (!hosts || hosts.length < 2 || !hosts.some((h) => sameHost(h.url, currentUrl))) return null
  let best: BandHostEntry | null = null
  let bestEpoch = currentEpoch
  for (const host of hosts) {
    if (sameHost(host.url, currentUrl)) continue
    const epoch = probes[host.url]
    if (typeof epoch === 'number' && epoch > bestEpoch) {
      best = host
      bestEpoch = epoch
    }
  }
  return best
}

/** One round: asks the other host(s) for their epoch and switches when one is ahead. */
export async function followHostOnce(args: {
  hosts: readonly BandHostEntry[] | undefined
  currentUrl: string
  currentEpoch: number
  probe: (url: string) => Promise<number | null>
  switchTo: (host: BandHostEntry) => void
}): Promise<void> {
  const { hosts, currentUrl, currentEpoch, probe, switchTo } = args
  if (!hosts || hosts.length < 2) return
  const others = hosts.filter((h) => !sameHost(h.url, currentUrl))
  const results = await Promise.all(others.map(async (h) => [h.url, await probe(h.url)] as const))
  const next = hostToFollow(hosts, currentUrl, currentEpoch, Object.fromEntries(results))
  if (next) switchTo(next)
}

const PROBE_TIMEOUT_MS = 3_000

/** The epoch a host announces on `/time`, or null when it does not answer or announces none. */
export async function probeHostEpoch(url: string): Promise<number | null> {
  try {
    const response = await fetch(`${url}/time`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!response.ok) return null
    const answer = HostTimeAnswerSchema.safeParse(await response.json())
    return answer.success ? (answer.data.epoch ?? null) : null
  } catch {
    return null
  }
}
