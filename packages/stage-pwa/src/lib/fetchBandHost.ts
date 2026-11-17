import { BandHostEntrySchema, HostTimeAnswerSchema, type BandHostEntry } from 'shared-types'
import { normalizeStageServerUrl } from './stageServer'

const TIMEOUT_MS = 5_000

/** What a typed or discovered host address becomes: https, no trailing slash. Null for plain http -
 * the app only talks to a host over https - or empty input. */
export function hostUrlFromInput(input: string): string | null {
  const typed = input.trim()
  if (typed === '' || /^http:\/\//i.test(typed)) return null
  return normalizeStageServerUrl(/^https:\/\//i.test(typed) ? typed : `https://${typed}`)
}

/**
 * Asks a host who it is (host backup, #914): its `hostId` from `/time` and its certificate
 * fingerprint from `/server-info`, so the admin never types either. Null when it does not answer,
 * is built before host ids existed (it cannot be named in the list), or sends a fingerprint in a
 * form the list would reject.
 */
export async function fetchBandHost(input: string): Promise<Omit<BandHostEntry, 'priority' | 'equipmentId'> | null> {
  const url = hostUrlFromInput(input)
  if (!url) return null
  try {
    const [time, info] = await Promise.all([
      fetch(`${url}/time`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
      fetch(`${url}/server-info`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    ])
    if (!time.ok || !info.ok) return null
    const answer = HostTimeAnswerSchema.safeParse(await time.json())
    if (!answer.success || !answer.data.hostId) return null
    const { certFingerprint } = (await info.json()) as { certFingerprint?: string | null }
    const entry = BandHostEntrySchema.omit({ priority: true, equipmentId: true }).safeParse({
      hostId: answer.data.hostId,
      url,
      ...(certFingerprint ? { certFingerprint } : {}),
    })
    return entry.success ? entry.data : null
  } catch {
    return null
  }
}
