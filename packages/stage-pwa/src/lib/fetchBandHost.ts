import { BandHostEntrySchema, type BandHostEntry } from 'shared-types'
import { getHostUrl } from './hostUrl'

const TIMEOUT_MS = 5_000

/** What a typed address becomes: https, no trailing slash. Null for plain http - the app only talks to
 * a host over https - or empty input. */
export function hostUrlFromInput(input: string): string | null {
  const typed = input.trim()
  if (typed === '' || /^http:\/\//i.test(typed)) return null
  return (/^https:\/\//i.test(typed) ? typed : `https://${typed}`).replace(/\/+$/, '')
}

/**
 * Who is at that address (host backup, #914): its `hostId` and its certificate fingerprint, so the admin
 * never types either. The *own* Host does the asking (#945): a page may only talk to hosts it
 * already trusts, and a fresh backup is not one of them yet - in a browser that is CORS, in the app a
 * missing pin. Null when it is not a Host, was built before host ids existed (it cannot be named
 * in the list), or sends a fingerprint in a form the list would reject.
 */
export async function fetchBandHost(input: string): Promise<Omit<BandHostEntry, 'priority' | 'equipmentId'> | null> {
  const url = hostUrlFromInput(input)
  const base = getHostUrl()
  if (!url || !base) return null
  try {
    const response = await fetch(`${base}/host/look-up?address=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) return null
    const entry = BandHostEntrySchema.omit({ priority: true, equipmentId: true }).safeParse(await response.json())
    return entry.success ? entry.data : null
  } catch {
    return null
  }
}
