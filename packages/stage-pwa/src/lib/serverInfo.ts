import { getHostUrl } from './hostUrl'

/**
 * Fetches the Host's own current LAN IP and certificate fingerprint (core-backend's `GET /host/info`, detected
 * fresh on every call - see #21 seventh follow-up, at Marco's explicit request) - used by
 * `InviteBandView.tsx` to embed a reachable address in the invite QR code instead of baking one
 * host in forever. `null` on any failure (unreachable server, no LAN interface detected) - the
 * caller falls back to the older code-only QR rather than showing an error for something that
 * doesn't block joining by hand.
 */
/** The address another device uses to reach this server: the LAN IP, plus the port when it is not
 * HTTPS's 443 (a laptop host, a second server - #896). */
export function hostWithPort(lanIp: string, port: number | null | undefined): string {
  return port && port !== 443 ? `${lanIp}:${port}` : lanIp
}

export async function fetchServerAddress(): Promise<{ host: string; certFingerprint: string | null } | null> {
  const base = getHostUrl()
  if (!base) return null
  try {
    const response = await fetch(`${base}/host/info`)
    if (!response.ok) return null
    const { lanIp, port, certFingerprint } = (await response.json()) as { lanIp: string | null; port?: number | null; certFingerprint?: string | null }
    // The certificate fingerprint lets the native app pin the server when it scans the QR (#348).
    return lanIp ? { host: hostWithPort(lanIp, port), certFingerprint: certFingerprint ?? null } : null
  } catch {
    return null
  }
}
