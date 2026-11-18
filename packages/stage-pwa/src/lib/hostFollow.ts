import { HostTimeAnswerSchema, type BandHostEntry } from 'shared-types'

/**
 * Following the host with the highest epoch (host backup, #916, docs/25 §6e). After a takeover the
 * backup announces a higher epoch; a device moves to it, and never back to a host with a lower or
 * equal one - an equal epoch is no reason to move, so a Wi-Fi hiccup cannot make it flap.
 */

const sameHost = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase()

/** What a host announced on `/time`: its epoch and, if it says, whether it is the band's host now. */
export interface HostSeen {
  epoch: number
  active?: boolean
}

/**
 * The listed host to move to, or null to stay. `probes`: what each other host announced just now (null:
 * it did not answer or announced no epoch). Only with two listed hosts, one of them the current one.
 * A host with a higher epoch wins. After a handback (#938) both hosts are on the same epoch and only one
 * of them is the band's host: a device on a host that says it is passive moves to one that says it is
 * active, at an epoch at least as high - never to a lower one (the out-of-date old primary), never from
 * an active host to a passive one, and never when nothing says who is active.
 */
export function hostToFollow(
  hosts: readonly BandHostEntry[] | undefined,
  currentUrl: string,
  current: { epoch: number; active?: boolean },
  probes: Readonly<Record<string, HostSeen | null>>,
): BandHostEntry | null {
  if (!hosts || hosts.length < 2 || !hosts.some((h) => sameHost(h.url, currentUrl))) return null
  let best: BandHostEntry | null = null
  let bestEpoch = -1
  for (const host of hosts) {
    if (sameHost(host.url, currentUrl)) continue
    const other = probes[host.url]
    if (!other) continue
    const ahead = other.epoch > current.epoch
    const takesOver = current.active === false && other.active === true && other.epoch >= current.epoch
    if ((ahead || takesOver) && other.epoch > bestEpoch) {
      best = host
      bestEpoch = other.epoch
    }
  }
  return best
}

/** One round: asks the other host(s) what they announce and switches when one should be followed. */
export async function followHostOnce(args: {
  hosts: readonly BandHostEntry[] | undefined
  currentUrl: string
  currentEpoch: number
  /** What the current host said about being the band host (#938). */
  currentActive?: boolean
  probe: (url: string) => Promise<HostSeen | null>
  switchTo: (host: BandHostEntry) => void
}): Promise<void> {
  const { hosts, currentUrl, currentEpoch, currentActive, probe, switchTo } = args
  if (!hosts || hosts.length < 2) return
  const others = hosts.filter((h) => !sameHost(h.url, currentUrl))
  const results = await Promise.all(others.map(async (h) => [h.url, await probe(h.url)] as const))
  const next = hostToFollow(hosts, currentUrl, { epoch: currentEpoch, active: currentActive }, Object.fromEntries(results))
  if (next) switchTo(next)
}

const PROBE_TIMEOUT_MS = 3_000

/** What a host announces on `/time`, or null when it does not answer or announces no epoch. */
export async function probeHostEpoch(url: string): Promise<HostSeen | null> {
  try {
    const response = await fetch(`${url}/time`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!response.ok) return null
    const answer = HostTimeAnswerSchema.safeParse(await response.json())
    if (!answer.success || answer.data.epoch === undefined) return null
    return { epoch: answer.data.epoch, ...(answer.data.active === undefined ? {} : { active: answer.data.active }) }
  } catch {
    return null
  }
}
