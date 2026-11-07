import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import PouchDB from 'pouchdb-browser'
import { createSyncHost } from 'sync-host'

/**
 * Spike "Android as host" (docs/25, 2026-11-07): this app answers sync requests from other devices
 * over the band database it already holds - the native web server (LocalHostPlugin.java) hands
 * each request here, sync-host answers it, the answer goes back. Started over the debug connection
 * (`window.__sbStartLocalHost()`), no UI yet; access with a token made for the spike.
 */
interface LocalHostPlugin {
  start: (options: { port: number; user: string; password: string }) => Promise<{ port: number; address: string | null }>
  stop: () => Promise<void>
  respond: (options: { id: string; status: number; contentType: string; text?: string; body?: string }) => Promise<void>
  addListener: (event: 'request', handler: (req: HostRequest) => void) => Promise<PluginListenerHandle>
}
interface HostRequest {
  id: string
  method: string
  path: string
  query: string
  contentType: string
  /** JSON as text; only binary comes as Base64 (`body`). */
  text?: string
  body?: string
}

const LocalHost = registerPlugin<LocalHostPlugin>('LocalHost')

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

let listener: PluginListenerHandle | null = null

/** Per request kind: count, time in sync-host, time to parse and answer (spike measurements). */
const stats: Record<string, { n: number; handlerMs: number; bridgeMs: number }> = {}
if (typeof window !== 'undefined') (window as unknown as { __sbHostStats: typeof stats }).__sbHostStats = stats

export async function startLocalHostSpike(port = 5985): Promise<{ url: string; user: string; password: string }> {
  const password = toBase64(crypto.getRandomValues(new Uint8Array(12))).replace(/[^A-Za-z0-9]/g, '')
  const opened = new Map<string, PouchDB.Database>()
  // Only the band databases this app holds - never one made up by a request.
  const handler = createSyncHost({
    open: (name) => {
      if (!name.startsWith('stageboard-')) return null
      let db = opened.get(name)
      if (!db) {
        db = new PouchDB(name) as unknown as PouchDB.Database
        opened.set(name, db)
      }
      return db
    },
  })
  await listener?.remove()
  listener = await LocalHost.addListener('request', (req) => {
    void (async () => {
      const t0 = performance.now()
      const body = req.text !== undefined ? (req.text === '' ? undefined : JSON.parse(req.text)) : { data: fromBase64(req.body ?? ''), contentType: req.contentType }
      const t1 = performance.now()
      const out = await handler({ method: req.method, path: req.path, query: Object.fromEntries(new URLSearchParams(req.query)), body })
      const t2 = performance.now()
      const text = out.binary ? null : JSON.stringify(out.body)
      const t3 = performance.now()
      const kind = req.path.split('/')[2] ?? 'db'
      const s = (stats[kind] ??= { n: 0, handlerMs: 0, bridgeMs: 0 })
      s.n++
      s.handlerMs += t2 - t1
      s.bridgeMs += t1 - t0 + (t3 - t2)
      if (out.binary) await LocalHost.respond({ id: req.id, status: out.status, contentType: out.binary.contentType, body: toBase64(out.binary.data) })
      else await LocalHost.respond({ id: req.id, status: out.status, contentType: 'application/json', text: text ?? 'null' })
    })().catch((err: unknown) => {
      void LocalHost.respond({ id: req.id, status: 500, contentType: 'application/json', text: JSON.stringify({ error: String(err) }) })
    })
  })
  const started = await LocalHost.start({ port, user: 'host', password })
  return { url: `http://${started.address ?? '?'}:${started.port}`, user: 'host', password }
}

if (typeof window !== 'undefined') (window as unknown as { __sbStartLocalHost: typeof startLocalHostSpike }).__sbStartLocalHost = startLocalHostSpike
