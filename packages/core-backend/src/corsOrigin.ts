/**
 * Which page origins a host answers cross-origin (#926): the configured ones (`FRONTEND_ORIGIN`),
 * and the origins of the hosts in the band's host list. A device opened from one host must read
 * the other host's `/time` to see its epoch (#916) - without this the browser blocks the reply and
 * the device could never move to the backup. A request without an origin is no browser page.
 */
export function corsOriginAllowed(origin: string | undefined, configured: readonly string[], listedHosts: readonly string[]): boolean {
  if (origin === undefined) return true
  return configured.includes(origin) || listedHosts.includes(origin)
}
