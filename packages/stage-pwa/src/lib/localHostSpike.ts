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
  respond: (options: { id: string; status: number; contentType: string; body: string }) => Promise<void>
  addListener: (event: 'request', handler: (req: HostRequest) => void) => Promise<PluginListenerHandle>
}
interface HostRequest {
  id: string
  method: string
  path: string
  query: string
  contentType: string
  body: string
}

const LocalHost = registerPlugin<LocalHostPlugin>('LocalHost')

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

let listener: PluginListenerHandle | null = null

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
      const raw = fromBase64(req.body)
      const body = raw.length === 0 ? undefined : req.contentType.includes('json') || req.contentType === '' ? JSON.parse(new TextDecoder().decode(raw)) : { data: raw, contentType: req.contentType }
      const out = await handler({ method: req.method, path: req.path, query: Object.fromEntries(new URLSearchParams(req.query)), body })
      const bytes = out.binary ? out.binary.data : new TextEncoder().encode(JSON.stringify(out.body))
      await LocalHost.respond({ id: req.id, status: out.status, contentType: out.binary?.contentType ?? 'application/json', body: toBase64(bytes) })
    })().catch((err: unknown) => {
      void LocalHost.respond({ id: req.id, status: 500, contentType: 'application/json', body: toBase64(new TextEncoder().encode(JSON.stringify({ error: String(err) }))) })
    })
  })
  const started = await LocalHost.start({ port, user: 'host', password })
  return { url: `http://${started.address ?? '?'}:${started.port}`, user: 'host', password }
}

if (typeof window !== 'undefined') (window as unknown as { __sbStartLocalHost: typeof startLocalHostSpike }).__sbStartLocalHost = startLocalHostSpike
