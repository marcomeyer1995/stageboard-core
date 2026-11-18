const TIMEOUT_MS = 10_000

export type HostActionResult =
  /** The host did it (take over / handing back is on its way). */
  | 'done'
  /** The host would not: it is not in the state for it (409). */
  | 'refused'
  /** The host did not accept the admin's login (403). */
  | 'denied'
  /** No answer, or an error. */
  | 'unreachable'

/**
 * The admin's hand-made host change (host backup, #943): "take over now" is sent to the backup,
 * "hand back now" to the primary - to that host itself, not to the one this device is on. The admin proves who they
 * are with their device login of the band, as on the other admin routes.
 */
export async function hostAction(hostUrl: string, action: 'take-over' | 'hand-back', admin: { adminUsername: string; adminPassword: string }): Promise<HostActionResult> {
  try {
    const response = await fetch(`${hostUrl.replace(/\/+$/, '')}/host/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(admin),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.ok) return 'done'
    if (response.status === 409) return 'refused'
    if (response.status === 403) return 'denied'
    return 'unreachable'
  } catch {
    return 'unreachable'
  }
}
