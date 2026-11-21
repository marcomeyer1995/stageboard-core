import type { HostMessage } from 'shared-types'
import type { HostRoute, HostRouteResponse } from './routes.js'

/**
 * The song look-up routes (#964): `GET /lookup/:provider/search?q=` and `/detail?resultId=` as routes of the shared table. What is answered here, once: the
 * 400 for a missing parameter, the 403 when a provider needs an add-on the band does not have (Ultimate Guitar, #546), the 404 for a provider nobody
 * knows, the 502 with the provider's own error body when it fails. The providers themselves - a catalogue API, a page scraped with a browser engine -
 * are the platform's (`LookupPorts`); a host without them passes none and a request is the capability refusal (501) of #962.
 *
 * `resultId` travels as a query parameter, not a path one: an opaque id can embed a whole source URL, and a router rejects a long path segment.
 */
export interface LookupPorts {
  /** null: no such provider. A throw is a failed look-up (502). */
  search(provider: string, query: string): Promise<unknown | null>
  fetchDetail(provider: string, resultId: string): Promise<unknown | null>
  /** Why this band may not use this provider (its add-on is missing), or null. `workspace` is the band the app says it asks for. */
  refusal(provider: string, workspace: string | undefined): Promise<HostMessage | null>
  /** The body of a failed look-up (its code and message). */
  errorBody(err: unknown): unknown
  log?: { error: (meta: Record<string, unknown>, message: string) => void }
}

const bad = (message: string): HostRouteResponse => ({ status: 400, body: { status: 'error', message } })

export function createLookupRoutes(ports: LookupPorts): HostRoute[] {
  const answer = async (provider: string, workspace: string | undefined, what: 'search' | 'detail', run: () => Promise<unknown | null>): Promise<HostRouteResponse> => {
    const refusal = await ports.refusal(provider, workspace)
    if (refusal) return { status: 403, body: { status: 'error', ...refusal } }
    try {
      const result = await run()
      return result === null ? { status: 404, body: { status: 'error', message: `Unknown provider: ${provider}` } } : { status: 200, body: result }
    } catch (err) {
      ports.log?.error({ err, provider, cause: (err as { cause?: unknown }).cause }, what === 'search' ? 'Lookup search failed' : 'Lookup detail failed')
      return { status: 502, body: ports.errorBody(err) }
    }
  }
  const providerOf = (params: Record<string, string>) => {
    try {
      return decodeURIComponent(params.provider ?? '')
    } catch {
      return ''
    }
  }
  return [
    {
      method: 'GET',
      pattern: '/lookup/:provider/search',
      handle: async (request) => {
        const { q, workspace } = request.query as { q?: string; workspace?: string }
        if (!q) return bad('Missing query parameter q')
        const provider = providerOf(request.params)
        return answer(provider, workspace, 'search', () => ports.search(provider, q))
      },
    },
    {
      method: 'GET',
      pattern: '/lookup/:provider/detail',
      handle: async (request) => {
        const { resultId, workspace } = request.query as { resultId?: string; workspace?: string }
        if (!resultId) return bad('Missing query parameter resultId')
        const provider = providerOf(request.params)
        return answer(provider, workspace, 'detail', () => ports.fetchDetail(provider, resultId))
      },
    },
  ]
}
