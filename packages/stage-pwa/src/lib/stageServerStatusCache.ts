import type { WorkspaceSummary } from 'shared-types'

export interface StageServerSnapshot {
  lanIp: string | null
  hostname: string | null
  workspaces: WorkspaceSummary[] | null
  activeWorkspaceId: string | null
}

const EMPTY: StageServerSnapshot = { lanIp: null, hostname: null, workspaces: null, activeWorkspaceId: null }

/**
 * The last Stage-Server status this page actually got an answer for, shared by every screen that
 * shows it (Settings, the Band tab, the Device Ledger) - so opening one of them shows the last
 * known state instantly and refreshes it in the background, instead of every open starting from a
 * blank "Lade…". In memory only, and only ever holds data from a server that answered: it's
 * cleared the moment the server is found unreachable, so it never presents stale data as current.
 * Its own tiny module (no imports beyond types) so the test setup can clear it after every test
 * without dragging the whole store into every test file.
 */
let lastKnown: StageServerSnapshot | null = null

export function getLastKnownStageServer(): StageServerSnapshot | null {
  return lastKnown
}

export function updateLastKnownStageServer(patch: Partial<StageServerSnapshot>): StageServerSnapshot {
  lastKnown = { ...(lastKnown ?? EMPTY), ...patch }
  return lastKnown
}

export function clearLastKnownStageServer(): void {
  lastKnown = null
}
