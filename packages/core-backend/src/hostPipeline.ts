import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { HostAnswer, HostRequest } from 'sync-host'

/**
 * The laptop answers through the same host pipeline as the tablet (#964 step 2): Fastify is only the listener (TLS, HTTP/2, body
 * parsing, CORS) and hands every request it has no file for to `answer` (sync-host's `answerHostRequest` with the Node shell's deps).
 * What comes back is written as it is: JSON, bytes, or a live stream as server-sent events.
 */
export function registerHostPipeline(app: FastifyInstance, answer: (request: HostRequest) => Promise<HostAnswer>): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const abort = new AbortController()
    reply.raw.on('close', () => abort.abort())
    const out = await answer(hostRequestOf(request, abort.signal))
    if (out.stream) return openStream(request, reply, out.stream)
    reply.status(out.status)
    for (const [name, value] of Object.entries(out.headers ?? {})) reply.header(name, value)
    if (out.binary) return reply.type(out.binary.contentType).send(Buffer.from(out.binary.data))
    return out.body === undefined ? reply.send() : reply.send(out.body)
  }
  app.route({ method: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'], url: '/*', handler })
}

/** What Fastify parsed, as the host takes it. The path stays raw (still URL-encoded): the shared handlers decode an id themselves once. */
export function hostRequestOf(request: FastifyRequest, signal?: AbortSignal): HostRequest {
  const contentType = request.headers['content-type']
  return {
    method: request.method,
    path: request.url.split('?')[0] ?? request.url,
    query: (request.query ?? {}) as Record<string, string>,
    ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
    // The address the TCP connection came from - never taken from the client (it cannot know its own LAN address).
    remoteAddress: request.ip,
    // JSON as parsed; an upload as the Buffer Fastify's catch-all parser hands over (a Uint8Array).
    body: request.body,
    ...(contentType !== undefined ? { contentType: String(contentType) } : {}),
    ...(signal ? { signal } : {}),
  }
}

/** No login on a stream: a page opens it with EventSource, which cannot send one (presence reveals only which already-visible roster member is active). */
function openStream(request: FastifyRequest, reply: FastifyReply, subscribe: NonNullable<HostAnswer['stream']>): void {
  reply.hijack()
  // The headers Fastify already queued (CORS from the cors plugin's hook) are copied one by one: `writeHead()` takes no record alongside a status.
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) reply.raw.setHeader(name, value)
  }
  reply.raw.setHeader('Content-Type', 'text/event-stream')
  reply.raw.setHeader('Cache-Control', 'no-cache')
  // HTTP/2 forbids connection-specific headers (RFC 7540 §8.1.2.2) and Node's h2 layer throws on one: only for an HTTP/1.x client.
  if (request.raw.httpVersionMajor < 2) reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.writeHead(200)
  const unsubscribe = subscribe((payload) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`))
  request.raw.on('close', unsubscribe)
}
