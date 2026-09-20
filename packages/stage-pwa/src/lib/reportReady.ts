import { getStageServerUrl } from './stageServer'

/** POSTs "this profile is ready" for a Ready Check (#60). Returns whether the Stage-Server took
 * it - the caller keeps the overlay up and lets the musician retry when it did not, since a
 * silently lost answer would leave the bandleader waiting on someone who did tap. */
export async function reportReady(workspaceId: string, checkId: string, profileId: string): Promise<boolean> {
  const base = getStageServerUrl()
  if (!base) return false

  try {
    const response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/ready-check/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkId, profileId }),
    })
    return response.ok
  } catch {
    return false
  }
}
