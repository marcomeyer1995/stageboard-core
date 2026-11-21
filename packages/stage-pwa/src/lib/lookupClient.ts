import type { LookupResult } from 'shared-types'
import { serverText } from './serverMessage'
import { NO_HOST_MESSAGE, HOST_UNREACHABLE_MESSAGE } from './hostUrl'
import { resolveHostFor } from './jobHost'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/** The band, so the server can check its add-ons (Ultimate Guitar, #546). */
export function bandParam(): string {
  return `&workspace=${encodeURIComponent(useWorkspaceStore.getState().activeWorkspaceId)}`
}

export type LookupClientResult<T> = { status: 'ok'; data: T } | { status: 'error'; message: string }

/** GET a JSON answer from the Host, with its errors as a message (also the YouTube search, #618). */
export async function getJson<T>(url: string): Promise<LookupClientResult<T>> {
  // A job a host may not be able to do (lookup, YouTube search): the host that can gets it (#962).
  const resolved = await resolveHostFor('GET', url.split('?')[0]!)
  if (resolved.base === null) return { status: 'error', message: resolved.message === 'no-host' ? NO_HOST_MESSAGE : resolved.message }
  const base = resolved.base

  try {
    const response = await fetch(`${base}${url}`)
    const body = await response.json()
    if (!response.ok) {
      const message = serverText(body as { message?: string } | null) ?? `HTTP ${response.status}`
      return { status: 'error', message }
    }
    return { status: 'ok', data: body as T }
  } catch (err) {
    // fetch() only throws when no answer came at all (offline, server down, other network).
    if (err instanceof TypeError) return { status: 'error', message: HOST_UNREACHABLE_MESSAGE }
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

export async function searchLookup(
  provider: string,
  query: string,
): Promise<LookupClientResult<LookupResult[]>> {
  return getJson(`/lookup/${provider}/search?q=${encodeURIComponent(query)}${bandParam()}`)
}

export async function fetchLookupDetail(
  provider: string,
  resultId: string,
): Promise<LookupClientResult<Record<string, unknown>>> {
  return getJson(`/lookup/${provider}/detail?resultId=${encodeURIComponent(resultId)}${bandParam()}`)
}
