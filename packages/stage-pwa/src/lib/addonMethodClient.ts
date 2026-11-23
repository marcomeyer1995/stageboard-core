import type { AddonError } from 'shared-types'
import { getHostUrl, HOST_UNREACHABLE_MESSAGE, NO_HOST_MESSAGE } from './hostUrl'
import { resolveExecutorFor } from './jobHost'
import { loadOf, selfFor } from './executorSelf'
import { bandParam } from './lookupClient'
import { localAddonMethods } from './addonWork'

export type AddonMethodResult = { ok: true; body: unknown } | { ok: false; error: AddonError }

/**
 * Asks an add-on's method of a host that can run it (docs/36 §3, #964): the host with the helpers the add-on needs answers, or none does and the
 * answer says what is missing. The answer is the add-on's own - this client knows no add-on's domain.
 */
export async function callAddonMethod(addonId: string, method: string, body: unknown): Promise<AddonMethodResult> {
  const path = `/addons/${encodeURIComponent(addonId)}/methods/${encodeURIComponent(method)}`
  // First this device itself, when it has what the add-on needs; a heavy method only when no host is clearly stronger. Then the host it is on, then another one.
  const executor = await resolveExecutorFor(addonId, loadOf(addonId, method), await selfFor(addonId))
  if (executor.where === 'self') return localAddonMethods.call(addonId, method, body)
  if (executor.where === 'none') {
    const message = !getHostUrl() ? NO_HOST_MESSAGE : [executor.needs ? `Missing: ${executor.needs}.` : '', executor.note ?? ''].filter(Boolean).join(' ') || `No host of this band can run "${addonId}".`
    return { ok: false, error: { code: 'host.none', message } }
  }
  const resolved = { base: executor.url }
  try {
    const response = await fetch(`${resolved.base}${path}?${bandParam().slice(1)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    const answer = (await response.json().catch(() => null)) as { ok?: boolean; body?: unknown; error?: AddonError; message?: string } | null
    if (answer?.ok === true) return { ok: true, body: answer.body }
    if (answer?.ok === false && answer.error) return { ok: false, error: answer.error }
    return { ok: false, error: { code: 'host.refused', message: answer?.message ?? `HTTP ${response.status}` } }
  } catch (err) {
    return { ok: false, error: { code: 'host.unreachable', message: err instanceof TypeError ? HOST_UNREACHABLE_MESSAGE : err instanceof Error ? err.message : String(err) } }
  }
}
