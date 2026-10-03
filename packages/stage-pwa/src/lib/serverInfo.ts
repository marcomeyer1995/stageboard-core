import { getStageServerUrl } from './stageServer'

/**
 * Fetches the Stage-Server's own current LAN IP and certificate fingerprint (core-backend's `GET /server-info`, detected
 * fresh on every call - see #21 seventh follow-up, at Marco's explicit request) - used by
 * `InviteBandView.tsx` to embed a reachable address in the invite QR code instead of baking one
 * host in forever. `null` on any failure (unreachable server, no LAN interface detected) - the
 * caller falls back to the older code-only QR rather than showing an error for something that
 * doesn't block joining by hand.
 */
export async function fetchServerAddress(): Promise<{ lanIp: string; certFingerprint: string | null } | null> {
  const base = getStageServerUrl()
  if (!base) return null
  try {
    const response = await fetch(`${base}/server-info`)
    if (!response.ok) return null
    const { lanIp, certFingerprint } = (await response.json()) as { lanIp: string | null; certFingerprint?: string | null }
    // The certificate fingerprint lets the native app pin the server when it scans the QR (#348).
    return lanIp ? { lanIp, certFingerprint: certFingerprint ?? null } : null
  } catch {
    return null
  }
}
