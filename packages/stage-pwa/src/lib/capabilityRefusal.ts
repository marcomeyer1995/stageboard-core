import i18n from '../i18n'

/**
 * The words for a host that answered "I cannot do that" (#962): 501 with `capability_missing`, the capability and what it
 * lacks. null for any other answer - the caller keeps its own message. A host is refused for what it lacks, never for being
 * a tablet, so this is what a person sees when they asked a device that cannot (stem separation on a weak tablet).
 */
export async function capabilityRefusal(response: Response): Promise<string | null> {
  if (response.status !== 501) return null
  try {
    const body = (await response.clone().json()) as { error?: unknown; capability?: unknown; needs?: unknown }
    if (body.error !== 'capability_missing') return null
    const capability = typeof body.capability === 'string' ? body.capability : '?'
    const needs = typeof body.needs === 'string' && body.needs !== '' ? body.needs : '?'
    return i18n.t('band:err.capabilityMissing', { capability, needs })
  } catch {
    return null
  }
}
