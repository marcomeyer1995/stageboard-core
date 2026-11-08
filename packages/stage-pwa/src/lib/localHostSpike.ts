import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import PouchDB from 'pouchdb-browser'
import { createHostLogin, createSyncHost, HOST_ACCOUNTS_DOC_ID, type HostAccount } from 'sync-host'

/**
 * Spike "Android as host" (docs/25, 2026-11-07): this app answers sync requests from other devices
 * over the band database it already holds - the native web server (LocalHostPlugin.java) hands
 * each request here, sync-host answers it, the answer goes back. Started over the debug connection
 * (`window.__sbStartLocalHost()`), no UI yet. Access: the band's device logins from its
 * `host-accounts` document (docs/25 §6b, C) - the Stage-Server writes it, every device holds it.
 */
interface LocalHostPlugin {
  start: (options: { port: number }) => Promise<{ port: number; address: string | null }>
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
  authorization?: string
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

/** The band database a request is about: `/<db>/…`, a live channel `/workspaces/<id>/…`, or the
 * native server's login question `/_host-login/<db>`. */
function bandOf(path: string): string | null {
  const parts = path.split('/').filter((p) => p !== '')
  if (parts[0] === 'workspaces' && parts[1]) return `stageboard-${decodeURIComponent(parts[1])}`
  if (parts[0] === '_host-login' && parts[1]) return decodeURIComponent(parts[1])
  return parts[0] ? decodeURIComponent(parts[0]) : null
}

export async function startLocalHostSpike(port = 5985): Promise<{ url: string }> {
  const opened = new Map<string, PouchDB.Database>()
  const open = (name: string) => {
    let db = opened.get(name)
    if (!db) {
      db = new PouchDB(name) as unknown as PouchDB.Database
      opened.set(name, db)
    }
    return db
  }
  // Only the band databases this app holds - never one made up by a request.
  const handler = createSyncHost({ open: (name) => (name.startsWith('stageboard-') ? open(name) : null) })
  const login = createHostLogin({
    accounts: async (db) =>
      db.startsWith('stageboard-') ? (((await open(db).get(HOST_ACCOUNTS_DOC_ID).catch(() => null)) as { accounts?: HostAccount[] } | null)?.accounts ?? []) : [],
  })
  await listener?.remove()
  listener = await LocalHost.addListener('request', (req) => {
    void (async () => {
      const t0 = performance.now()
      const body = req.text !== undefined ? (req.text === '' ? undefined : JSON.parse(req.text)) : { data: fromBase64(req.body ?? ''), contentType: req.contentType }
      const t1 = performance.now()
      const band = bandOf(req.path)
      if (band !== null && (await login(req.authorization, band)) === null) {
        await LocalHost.respond({ id: req.id, status: 401, contentType: 'application/json', text: JSON.stringify({ error: 'unauthorized', reason: 'Not a device of this band.' }) })
        return
      }
      if (req.path.startsWith('/_host-login/')) {
        await LocalHost.respond({ id: req.id, status: 200, contentType: 'application/json', text: '{"ok":true}' })
        return
      }
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
  const started = await LocalHost.start({ port })
  return { url: `http://${started.address ?? '?'}:${started.port}` }
}

if (typeof window !== 'undefined') (window as unknown as { __sbStartLocalHost: typeof startLocalHostSpike }).__sbStartLocalHost = startLocalHostSpike

/** Spike test only: puts a document into the local test database (never a band - it would sync). */
if (typeof window !== 'undefined')
  (window as unknown as { __sbSpikeTestPut: (doc: { _id: string }) => Promise<unknown> }).__sbSpikeTestPut = async (doc) => {
    const db = new PouchDB('stageboard-spike-test')
    const old = await db.get(doc._id).catch(() => null)
    return db.put({ ...doc, ...(old ? { _rev: old._rev } : {}) })
  }
