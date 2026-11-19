import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import PouchDB from 'pouchdb-core'
import LevelAdapter from 'pouchdb-adapter-leveldb'
import { createDatabaseHost, type Catalog, type DatabaseHostRequest } from 'sync-host/database-host'

PouchDB.plugin(LevelAdapter)

/**
 * The built-in database host (docs/25, Host step 1, 2026-11-07): instead of the database in Docker, the
 * Stage-Server runs sync-host's small the database itself, its databases in LevelDB files. It listens
 * where the database would (127.0.0.1:5984 by default), so `database.ts`, the `/db` proxy for the devices
 * and the command-line tools (PIN reset, delete a band) talk to it exactly as to the database - and only
 * this one process opens the files.
 */
export interface BuiltinDatabase {
  url: string
  close: () => Promise<void>
}

/** The list of databases, kept as a small JSON file beside them - written whole, then renamed. */
function fileCatalog(path: string): Catalog {
  let cache: Set<string> | null = null
  const load = async () => {
    if (!cache) {
      try {
        cache = new Set(JSON.parse(await readFile(path, 'utf8')) as string[])
      } catch {
        cache = new Set()
      }
    }
    return cache
  }
  const save = async (names: Set<string>) => {
    await writeFile(`${path}.tmp`, JSON.stringify([...names].sort(), null, 2))
    await rename(`${path}.tmp`, path)
  }
  return {
    list: async () => [...(await load())],
    add: async (name) => {
      const names = await load()
      names.add(name)
      await save(names)
    },
    remove: async (name) => {
      const names = await load()
      names.delete(name)
      await save(names)
    },
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks)
  if (raw.length === 0) return undefined
  const type = req.headers['content-type'] ?? ''
  if (type.includes('json') || type === '') {
    try {
      return JSON.parse(raw.toString('utf8'))
    } catch {
      return undefined
    }
  }
  return { data: new Uint8Array(raw), contentType: type }
}

export async function startBuiltinDatabase(options: { dataDir: string; user: string; password: string; port?: number; host?: string }): Promise<BuiltinDatabase> {
  const dbDir = join(options.dataDir, 'db')
  await mkdir(dbDir, { recursive: true })
  const handler = createDatabaseHost({
    // Revision history is bounded (#962, soak): a 4 h run of three devices writing the same 150 songs left ~1,200 revisions
    // per document and the host's write time rose from 8 ms to over a second. Old bodies are compacted on write and only the
    // last 50 ancestors are kept - more than enough to merge the few devices of a band.
    storage: (name) => new PouchDB(join(dbDir, encodeURIComponent(name)), { adapter: 'leveldb', auto_compaction: true, revs_limit: 50 }),
    catalog: fileCatalog(join(options.dataDir, 'databases.json')),
    admin: { user: options.user, password: options.password },
  })
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const abort = new AbortController()
      res.on('close', () => abort.abort())
      const request: DatabaseHostRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: await readBody(req),
        authorization: req.headers.authorization,
        signal: abort.signal,
      }
      const out = await handler(request)
      if (out.binary) {
        res.writeHead(out.status, { 'content-type': out.binary.contentType })
        res.end(Buffer.from(out.binary.data))
        return
      }
      res.writeHead(out.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(out.body))
    })().catch((err: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal', reason: err instanceof Error ? err.message : String(err) }))
    })
  })
  const host = options.host ?? '127.0.0.1'
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 5984, host, () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://${host}:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await handler.close()
    },
  }
}
