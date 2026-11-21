import { BandHostEntrySchema } from 'shared-types'

/** The band's settings document - one per band, only a band admin may write it (the band's validator). */
export const BAND_SETTINGS_DOC_ID = 'band-settings:band'

/**
 * The ids of the devices a band lists as its hosts, read from its settings document (host module, #960). A device on
 * this list gets the role `host` on its login (`createBandAccounts` `hostDevices`), which is what lets it write the band's
 * accounts. Entries that are not host entries are skipped one by one: a half-written or hand-made entry never makes a
 * device a host.
 */
export function listedHostIds(settings: unknown): string[] {
  const hosts = (settings as { hosts?: unknown } | null)?.hosts
  if (!Array.isArray(hosts)) return []
  return hosts.flatMap((entry) => {
    const parsed = BandHostEntrySchema.safeParse(entry)
    return parsed.success ? [parsed.data.hostId] : []
  })
}
