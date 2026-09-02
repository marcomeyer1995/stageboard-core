import { getStageServerUrl } from './stageServer'

/**
 * Fetches the Stage-Server's own current LAN IP (core-backend's `GET /server-info`, detected
 * fresh on every call - see #21 seventh follow-up, at Marco's explicit request) - used by
 * `InviteBandView.tsx` to embed a reachable address in the invite QR code instead of baking one
 * host in forever. `null` on any failure (unreachable server, no LAN interface detected) - the
 * caller falls back to the older code-only QR rather than showing an error for something that
 * doesn't block joining by hand.
 */
export async function fetchLanIp(): Promise<string | null> {
  const base = getStageServerUrl()
  if (!base) return null
  try {
    const response = await fetch(`${base}/server-info`)
    if (!response.ok) return null
    const { lanIp } = (await response.json()) as { lanIp: string | null }
    return lanIp
  } catch {
    return null
  }
}
