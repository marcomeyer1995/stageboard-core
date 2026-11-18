import { hostsByPriority, type BandHostEntry } from 'shared-types'

/**
 * What the stage map's "Prüfen" shows about the band's hosts (host backup, #941, docs/25 §6e item 5): which
 * of the two listed hosts is the band's host right now, which one stands by, and what is wrong. Pure - the
 * answers of the hosts' `/time` come in as `probes` (null: no answer).
 */
export interface HostProbe {
  hostId?: string
  epoch: number
  /** True: this host is the band's host now (#938). Absent: an older host that does not say. */
  active?: boolean
}

export type HostState = 'host' | 'standby' | 'outdated' | 'unreachable' | 'unknown'

export interface HostRow {
  hostId: string
  role: 'primary' | 'backup'
  url: string
  state: HostState
  /** ok / warning / error, as the map's other rows. */
  status: 'ok' | 'warning' | 'error' | 'off'
  epoch: number | null
  /** The host this device is on. */
  current: boolean
}

export interface HostOverview {
  rows: HostRow[]
  /** `none-reachable`: no host answers. `no-host`: some answer but none is the host (a takeover is pending or failed).
   * `two-hosts`: both say they are the host. */
  problem: 'none-reachable' | 'no-host' | 'two-hosts' | null
}

const trim = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase()

export function describeHosts(
  hosts: readonly BandHostEntry[] | undefined,
  probes: Readonly<Record<string, HostProbe | null>>,
  currentUrl: string | undefined,
): HostOverview {
  if (!hosts || hosts.length < 2) return { rows: [], problem: null }
  const byUrl = new Map(Object.entries(probes).map(([url, probe]) => [trim(url), probe]))

  const rows: HostRow[] = hostsByPriority(hosts).map((entry) => {
    const probe = byUrl.get(trim(entry.url)) ?? null
    const role = entry.priority === 1 ? 'primary' : 'backup'
    let state: HostState
    if (probe === null) state = 'unreachable'
    else if (probe.active === true) state = 'host'
    else if (probe.active === false) state = role === 'backup' ? 'standby' : 'outdated'
    else state = 'unknown'
    return {
      hostId: probe?.hostId ?? entry.hostId,
      role,
      url: entry.url,
      state,
      // A missing host or backup is something to know, not a fault: the show goes on without it.
      status: state === 'host' ? 'ok' : state === 'standby' ? 'off' : state === 'unknown' ? 'off' : 'warning',
      epoch: probe?.epoch ?? null,
      current: currentUrl !== undefined && trim(currentUrl) === trim(entry.url),
    }
  })

  const answered = rows.filter((r) => r.state !== 'unreachable')
  const hostsNow = rows.filter((r) => r.state === 'host')
  let problem: HostOverview['problem'] = null
  if (answered.length === 0) problem = 'none-reachable'
  else if (hostsNow.length >= 2) problem = 'two-hosts'
  // Only when the hosts say who is active: an older host that says nothing is not "no host".
  else if (hostsNow.length === 0 && answered.every((r) => r.state !== 'unknown')) problem = 'no-host'
  // Two hosts that both think they are the host is the one thing worse than a missing one.
  if (problem === 'two-hosts') for (const row of rows) if (row.state === 'host') row.status = 'error'
  return { rows, problem }
}

/**
 * The name of the backup host when this device is on it, else null - the one thing the status bar says about
 * the hosts (#941): in the normal state the device is on the primary and the bar has nothing to add.
 */
export function backupHostOf(hosts: readonly BandHostEntry[] | undefined, currentUrl: string | undefined): string | null {
  if (!hosts || hosts.length < 2 || !currentUrl) return null
  return hosts.find((h) => h.priority === 2 && trim(h.url) === trim(currentUrl))?.hostId ?? null
}
