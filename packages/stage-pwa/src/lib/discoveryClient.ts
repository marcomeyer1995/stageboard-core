import type { DetectedHardware } from 'shared-types'
import { getStageServerUrl } from './stageServer'

async function post(path: string, body: unknown): Promise<void> {
  const base = getStageServerUrl()
  if (!base) return // No Stage-Server (e.g. Tier 1 "Solo") - Discovery Mode has no coordinator, silently a no-op.
  try {
    await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    // Best-effort - the next report (or the admin's own retry) recovers; a dropped request here
    // isn't worth surfacing as an error to the musician who just plugged something in.
  }
}

/** Starts (or restarts) Discovery Mode for the workspace - admin-only in the UI, not enforced
 * here (same trust boundary as every other workspace-scoped write in this app). */
export function startDiscovery(workspaceId: string, startedBy: string | null): Promise<void> {
  return post(`/workspaces/${encodeURIComponent(workspaceId)}/discovery/start`, { startedBy })
}

export function stopDiscovery(workspaceId: string): Promise<void> {
  return post(`/workspaces/${encodeURIComponent(workspaceId)}/discovery/stop`, {})
}

/** Reports one currently-visible port into the active session - `reporterId` is this tablet's
 * own `getDeviceId()`. A no-op server-side unless a session is actually active. */
export function reportDiscoveryCandidate(workspaceId: string, reporterId: string, detected: DetectedHardware): Promise<void> {
  return post(`/workspaces/${encodeURIComponent(workspaceId)}/discovery/candidates`, { reporterId, detected })
}

/** Reports that this tablet's own candidate just produced the currently-identifying role's
 * trigger sequence (useDiscoveryTrigger.ts). */
export function reportDiscoveryTriggered(workspaceId: string, reporterId: string, hardwareKey: string): Promise<void> {
  return post(`/workspaces/${encodeURIComponent(workspaceId)}/discovery/triggered`, { reporterId, hardwareKey })
}

/** A human directly confirming "this candidate is this role" (DeviceSetupWizard.tsx's "Verwenden"
 * button) - for plugins with no `discoveryTrigger`, or whenever the auto/trigger paths left
 * things ambiguous, this is the only way a candidate ever reaches `assigned`. */
export function assignDiscoveryCandidate(
  workspaceId: string,
  reporterId: string,
  hardwareKey: string,
  logicalDeviceId: string,
): Promise<void> {
  return post(`/workspaces/${encodeURIComponent(workspaceId)}/discovery/assign`, { reporterId, hardwareKey, logicalDeviceId })
}
