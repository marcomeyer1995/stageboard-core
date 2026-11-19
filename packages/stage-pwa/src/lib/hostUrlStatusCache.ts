import type { WorkspaceSummary } from 'shared-types'

export interface HostUrlSnapshot {
  lanIp: string | null
  hostname: string | null
  workspaces: WorkspaceSummary[] | null
  activeWorkspaceId: string | null
}

const EMPTY: HostUrlSnapshot = { lanIp: null, hostname: null, workspaces: null, activeWorkspaceId: null }

/**
 * The last Host status this page actually got an answer for, shared by every screen that
 * shows it (Settings, the Band tab, the Device Ledger) - so opening one of them shows the last
 * known state instantly and refreshes it in the background, instead of every open starting from a
 * blank "Lade…". In memory only, and only ever holds data from a server that answered: it's
 * cleared the moment the server is found unreachable, so it never presents stale data as current.
 * Its own tiny module (no imports beyond types) so the test setup can clear it after every test
 * without dragging the whole store into every test file.
 */
let lastKnown: HostUrlSnapshot | null = null

export function getLastKnownHost(): HostUrlSnapshot | null {
  return lastKnown
}

export function updateLastKnownHost(patch: Partial<HostUrlSnapshot>): HostUrlSnapshot {
  lastKnown = { ...(lastKnown ?? EMPTY), ...patch }
  return lastKnown
}

export function clearLastKnownHost(): void {
  lastKnown = null
}
