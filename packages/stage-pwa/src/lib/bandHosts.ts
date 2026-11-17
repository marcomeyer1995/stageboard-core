import { hostsByPriority, type BandHostEntry } from 'shared-types'

/**
 * Changes to the band's host list (host backup, #914, docs/25 §6e): at most a primary (priority 1)
 * and a backup (2), one role per host. Pure - the caller writes the result to the band settings.
 */
type HostDetails = Omit<BandHostEntry, 'priority'>

/** Gives `host` the role. It leaves any role it had, and whoever held `role` before loses it (a new
 * primary moves the mark); the other role stays. */
export function assignHostRole(hosts: readonly BandHostEntry[] | undefined, host: HostDetails, role: 'primary' | 'backup'): BandHostEntry[] {
  const priority = role === 'primary' ? 1 : 2
  const kept = (hosts ?? []).filter((h) => h.hostId !== host.hostId && h.priority !== priority)
  return hostsByPriority([...kept, { ...host, priority }])
}

/** Takes the host out of the list; the other role stays. */
export function removeHostRole(hosts: readonly BandHostEntry[] | undefined, hostId: string): BandHostEntry[] {
  return hostsByPriority((hosts ?? []).filter((h) => h.hostId !== hostId))
}
