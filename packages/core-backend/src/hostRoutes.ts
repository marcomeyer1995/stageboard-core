import type { FastifyInstance } from 'fastify'
import { matchHostRoute, type HostRoute } from 'sync-host'

/**
 * Registers the routes every host shares (`sync-host`, #949) with Fastify: the table's own `pattern` is Fastify's
 * notation, so each entry is registered as it is. The route's params are taken from the raw request path, not
 * from Fastify's - Fastify has URL-decoded those already, and the shared handlers decode an id themselves once.
 */
export function registerHostRoutes(app: FastifyInstance, routes: readonly HostRoute[]): void {
  for (const route of routes) {
    app.route({
      method: route.method,
      url: route.pattern,
      handler: async (request, reply) => {
        const path = request.url.split('?')[0] ?? request.url
        const hit = matchHostRoute([route], request.method, path)
        const answer = await route.handle({
          method: request.method,
          path,
          params: hit?.params ?? {},
          query: (request.query ?? {}) as Record<string, string>,
          // JSON as parsed; an upload as the Buffer Fastify's catch-all parser hands over (a Uint8Array).
          body: request.body,
        })
        reply.status(answer.status)
        for (const [name, value] of Object.entries(answer.headers ?? {})) reply.header(name, value)
        if (answer.binary) return reply.type(answer.binary.contentType).send(Buffer.from(answer.binary.data))
        return answer.body === undefined ? reply.send() : reply.send(answer.body)
      },
    })
  }
}
