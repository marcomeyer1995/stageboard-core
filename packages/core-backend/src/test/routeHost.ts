import { matchHostRoute, type HostRoute } from 'sync-host'
import { createNodeHost, type NodeHost } from '../nodeHost.js'

/** A Node host that answers only `routes` (a route table on its own, for its tests), 404 otherwise. */
export function routeHost(routes: readonly HostRoute[]): NodeHost {
  const host = createNodeHost({ bodyLimit: 10 * 1024 * 1024, corsOrigin: () => false })
  host.setHandler(async (request) => {
    const hit = matchHostRoute(routes, request.method === 'HEAD' ? 'GET' : request.method, request.path)
    if (!hit) return { status: 404, body: { error: 'not_found' } }
    const answer = await hit.route.handle({ method: request.method, path: request.path, params: hit.params, query: request.query, body: request.body, ...(request.authorization ? { authorization: request.authorization } : {}), ...(request.remoteAddress ? { remoteAddress: request.remoteAddress } : {}) })
    return { status: answer.status, body: answer.body, ...(answer.binary ? { binary: answer.binary } : {}), ...(answer.headers ? { headers: answer.headers } : {}) }
  })
  return host
}
