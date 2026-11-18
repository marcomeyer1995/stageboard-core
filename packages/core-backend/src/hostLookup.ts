import { HostTimeAnswerSchema } from 'shared-types'
import { z } from 'zod'

/** A host as the band's list stores it: who it is, how to reach it, and the certificate to pin. */
export interface LookedUpHost {
  hostId: string
  url: string
  certFingerprint?: string
}

/** The form the band's host list accepts for a certificate fingerprint (SHA-256, lowercase hex). */
const FINGERPRINT = /^[0-9a-f]{64}$/

/**
 * Asks a host who it is (host backup, #914): its `hostId` from `/time` and its certificate fingerprint
 * from `/server-info`, so the admin never types either. Both requests are unpinned - it *is* the host the
 * admin just named, and the fingerprint is what gets pinned afterwards. The stage app asks its own
 * Stage-Server to do this (#945): a page may only talk to hosts it already trusts, and a fresh backup is
 * not one of them yet, so the host-to-host call keeps the certificate question in one place.
 *
 * Null when the host does not answer as a Stage-Server, was built before host ids existed (it cannot be
 * named in the list), or sends a fingerprint in a form the list would reject - that is never stored.
 */
export async function lookUpHost(address: string, get: (url: string) => Promise<unknown>): Promise<LookedUpHost | null> {
  const url = address.trim().replace(/\/+$/, '')
  const [time, info] = await Promise.all([get(`${url}/time`), get(`${url}/server-info`)])
  const answer = HostTimeAnswerSchema.safeParse(time)
  if (!answer.success || !answer.data.hostId) return null
  const fingerprint = (info as { certFingerprint?: unknown } | null)?.certFingerprint
  if (fingerprint === undefined || fingerprint === null) return { hostId: answer.data.hostId, url }
  if (typeof fingerprint !== 'string' || !FINGERPRINT.test(fingerprint)) return null
  return { hostId: answer.data.hostId, url, certFingerprint: fingerprint }
}

/** The stage app's query for `GET /host/look-up`: the address the admin typed, already https. */
export const HostLookupQuerySchema = z.object({ address: z.string().url().startsWith('https://') })
