/**
 * The epoch this host announces (host backup, #924). Only the takeover will raise it for real
 * (#920); until then `STAGEBOARD_HOST_EPOCH` lets a test run a second host under a higher one, so
 * the devices' following of it can be tried. A whole number of 1 or more; anything else is 1.
 */
export function configuredHostEpoch(env: Record<string, string | undefined> = process.env): number {
  const raw = env.STAGEBOARD_HOST_EPOCH?.trim()
  return raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number(raw) : 1
}
