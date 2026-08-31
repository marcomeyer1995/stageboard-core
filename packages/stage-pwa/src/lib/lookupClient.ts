import type { LookupResult } from 'shared-types'
import { getStageServerUrl } from './stageServer'

export type LookupClientResult<T> = { status: 'ok'; data: T } | { status: 'error'; message: string }

async function getJson<T>(url: string): Promise<LookupClientResult<T>> {
  const base = getStageServerUrl()
  if (!base) return { status: 'error', message: 'VITE_STAGE_SERVER_URL is not configured' }

  try {
    const response = await fetch(`${base}${url}`)
    const body = await response.json()
    if (!response.ok) {
      const message = (body as { message?: string } | null)?.message ?? `HTTP ${response.status}`
      return { status: 'error', message }
    }
    return { status: 'ok', data: body as T }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

export async function searchLookup(
  provider: string,
  query: string,
): Promise<LookupClientResult<LookupResult[]>> {
  return getJson(`/lookup/${provider}/search?q=${encodeURIComponent(query)}`)
}

export async function fetchLookupDetail(
  provider: string,
  resultId: string,
): Promise<LookupClientResult<Record<string, unknown>>> {
  return getJson(`/lookup/${provider}/detail?resultId=${encodeURIComponent(resultId)}`)
}
