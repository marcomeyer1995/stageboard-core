/**
 * The CouchDB replication protocol over a PouchDB database (docs/25, Marco 2026-11-07): what a
 * StageBoard device's PouchDB asks of its host when it syncs - database info, the change feed
 * (also long-polled), revision comparison, bulk write and read, checkpoints, single documents and
 * attachments. One implementation for every host: Fastify on a laptop (PouchDB in Node instead of
 * CouchDB in Docker) and later a small native web server in the Android app over the PouchDB it
 * already holds. No server library, no Node API - plain requests in, plain responses out.
 */

/** A request as the host's web server hands it on: the path from the database name on. */
export interface SyncRequest {
  method: string
  /** `/<db>`, `/<db>/_changes`, `/<db>/<doc id>/<attachment>` … - URL-encoded as received. */
  path: string
  query: Readonly<Record<string, string>>
  body?: unknown
  /** Fires when the client goes away - a long-polled change feed stops waiting. */
  signal?: AbortSignal
}

export interface SyncResponse {
  status: number
  body: unknown
  /** Raw bytes instead of JSON (an attachment). */
  binary?: { data: Uint8Array; contentType: string }
}

/** The part of a PouchDB database the protocol uses - any adapter (memory, LevelDB, IndexedDB). */
export type SyncDatabase = PouchDB.Database

export interface SyncHostOptions {
  /** The database of this name, or null when there is none (or the caller may not see it). */
  open: (name: string) => SyncDatabase | null
  /** Creates a database on `PUT /<db>` - absent: databases are made by the host, not by clients. */
  create?: (name: string) => SyncDatabase | null
  /** How long a long-polled change feed waits for a change, ms (CouchDB: 60 s). */
  longpollMaxMs?: number
}

const json = (status: number, body: unknown): SyncResponse => ({ status, body })
const error = (status: number, name: string, reason: string): SyncResponse => json(status, { error: name, reason })

function decode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** A query value as JSON (`open_revs=["1-a"]`), or the raw string. */
function parseValue(raw: string | undefined): unknown {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const flag = (raw: string | undefined) => raw === 'true'

function pouchError(e: unknown): SyncResponse {
  const err = e as { status?: number; name?: string; message?: string; reason?: string }
  return error(err.status ?? 500, err.name ?? 'error', err.reason ?? err.message ?? String(e))
}

/** Splits `/<db>/<rest…>` - a `_design/x` or `_local/x` id stays one id. */
function route(path: string): { db: string; rest: string[] } | null {
  const parts = path.split('/').filter((p) => p !== '')
  if (parts.length === 0) return null
  const [db, ...rest] = parts
  if ((rest[0] === '_local' || rest[0] === '_design') && rest.length >= 2) return { db: decode(db!), rest: [`${rest[0]}/${decode(rest[1]!)}`, ...rest.slice(2).map(decode)] }
  return { db: decode(db!), rest: rest.map(decode) }
}

export function createSyncHost(options: SyncHostOptions): (request: SyncRequest) => Promise<SyncResponse> {
  const longpollMaxMs = options.longpollMaxMs ?? 60_000

  return async (request) => {
    const method = request.method.toUpperCase()
    if (request.path === '/' || request.path === '') return json(200, { couchdb: 'Welcome', version: '3.3.3', vendor: { name: 'StageBoard sync-host' } })
    const r = route(request.path)
    if (!r) return error(400, 'bad_request', 'no database')
    if (r.rest.length === 0 && method === 'PUT') {
      if (!options.create) return error(403, 'forbidden', 'databases are made by the host')
      return options.create(r.db) ? json(201, { ok: true }) : error(403, 'forbidden', 'not allowed')
    }
    const db = options.open(r.db)
    if (!db) return error(404, 'not_found', 'Database does not exist.')
    try {
      return await handle(db, r.db, r.rest, method, request, longpollMaxMs)
    } catch (e) {
      return pouchError(e)
    }
  }
}

async function handle(db: SyncDatabase, name: string, rest: string[], method: string, request: SyncRequest, longpollMaxMs: number): Promise<SyncResponse> {
  const q = request.query
  const [first, second] = rest

  if (first === undefined) {
    if (method !== 'GET' && method !== 'HEAD') return error(405, 'method_not_allowed', method)
    const info = await db.info()
    return json(200, { db_name: name, doc_count: info.doc_count, update_seq: info.update_seq, instance_start_time: '0' })
  }

  switch (first) {
    case '_changes':
      return changes(db, method, request, longpollMaxMs)
    case '_revs_diff':
      return json(200, await db.revsDiff(request.body as PouchDB.Core.RevisionDiffOptions))
    case '_bulk_docs': {
      const body = request.body as { docs: PouchDB.Core.PutDocument<object>[]; new_edits?: boolean }
      const result = await db.bulkDocs(body.docs, { new_edits: body.new_edits ?? true })
      return json(201, result)
    }
    case '_bulk_get': {
      const body = request.body as { docs: { id: string; rev?: string }[] }
      const result = await db.bulkGet({ docs: body.docs, revs: flag(q.revs) || q.revs === undefined, attachments: flag(q.attachments), latest: flag(q.latest) } as PouchDB.Core.BulkGetOptions)
      return json(200, result)
    }
    case '_all_docs': {
      const keys = (request.body as { keys?: string[] } | undefined)?.keys ?? (parseValue(q.keys) as string[] | undefined)
      const opts: PouchDB.Core.AllDocsOptions = {
        include_docs: flag(q.include_docs),
        conflicts: flag(q.conflicts),
        attachments: flag(q.attachments),
        ...(q.limit ? { limit: Number(q.limit) } : {}),
        ...(q.skip ? { skip: Number(q.skip) } : {}),
        ...(q.descending ? { descending: flag(q.descending) } : {}),
        ...(q.startkey ? { startkey: parseValue(q.startkey) as string } : {}),
        ...(q.endkey ? { endkey: parseValue(q.endkey) as string } : {}),
      }
      return json(200, keys ? await db.allDocs({ ...opts, keys }) : await db.allDocs(opts))
    }
    case '_ensure_full_commit':
      return json(201, { ok: true, instance_start_time: '0' })
  }

  if (first.startsWith('_') && !first.startsWith('_local/') && !first.startsWith('_design/')) return error(400, 'bad_request', `unsupported: ${first}`)

  // A document, its attachment, or a checkpoint (`_local/…`).
  const id = first
  if (second !== undefined) return attachment(db, id, rest.slice(1).join('/'), method, request)
  switch (method) {
    case 'GET':
    case 'HEAD':
      return getDoc(db, id, q)
    case 'PUT': {
      const doc = { ...(request.body as object), _id: id } as PouchDB.Core.PutDocument<object>
      if (q.new_edits === 'false') return json(201, await db.bulkDocs([doc], { new_edits: false }))
      return json(201, await db.put(doc))
    }
    case 'DELETE': {
      const rev = q.rev ?? ''
      return json(200, await db.remove(id, rev))
    }
    default:
      return error(405, 'method_not_allowed', method)
  }
}

async function getDoc(db: SyncDatabase, id: string, q: Readonly<Record<string, string>>): Promise<SyncResponse> {
  const openRevs = parseValue(q.open_revs)
  const opts = {
    ...(q.rev ? { rev: q.rev } : {}),
    revs: flag(q.revs),
    revs_info: flag(q.revs_info),
    conflicts: flag(q.conflicts),
    attachments: flag(q.attachments),
    latest: flag(q.latest),
    ...(openRevs !== undefined ? { open_revs: openRevs as 'all' | string[] } : {}),
  }
  return json(200, await db.get(id, opts as PouchDB.Core.GetOptions))
}

async function attachment(db: SyncDatabase, id: string, attachmentId: string, method: string, request: SyncRequest): Promise<SyncResponse> {
  if (method === 'GET' || method === 'HEAD') {
    const doc = await db.get(id, { ...(request.query.rev ? { rev: request.query.rev } : {}), attachments: true, binary: true } as PouchDB.Core.GetOptions)
    const att = (doc as { _attachments?: Record<string, { content_type: string; data: Blob | Uint8Array }> })._attachments?.[attachmentId]
    if (!att) return error(404, 'not_found', 'Document is missing attachment')
    const data = att.data instanceof Uint8Array ? att.data : new Uint8Array(await (att.data as Blob).arrayBuffer())
    return { status: 200, body: null, binary: { data, contentType: att.content_type } }
  }
  if (method === 'PUT') {
    const body = request.body as { data: Uint8Array; contentType: string }
    // PouchDB in Node takes a Buffer, in the browser/WebView a Blob.
    const nodeBuffer = (globalThis as { Buffer?: { from: (d: Uint8Array) => Uint8Array } }).Buffer
    const blob = nodeBuffer ? nodeBuffer.from(body.data) : new Blob([body.data as BlobPart], { type: body.contentType })
    return json(201, await db.putAttachment(id, attachmentId, request.query.rev ?? '', blob as PouchDB.Core.AttachmentData, body.contentType))
  }
  if (method === 'DELETE') return json(200, await db.removeAttachment(id, attachmentId, request.query.rev ?? ''))
  return error(405, 'method_not_allowed', method)
}

/**
 * The change feed: `normal` returns what there is; `longpoll` waits until something changes (or
 * `timeout`, at most longpollMaxMs) - how a live replication keeps up. Filtered by `doc_ids` the
 * way PouchDB asks for it (`filter=_doc_ids`).
 */
async function changes(db: SyncDatabase, method: string, request: SyncRequest, longpollMaxMs: number): Promise<SyncResponse> {
  const q = request.query
  const body = (method === 'POST' ? request.body : undefined) as { doc_ids?: string[] } | undefined
  const docIds = q.filter === '_doc_ids' ? (body?.doc_ids ?? (parseValue(q.doc_ids) as string[] | undefined)) : undefined
  const since = q.since === undefined || q.since === 'now' ? (q.since === 'now' ? (await db.info()).update_seq : 0) : (parseValue(q.since) as number | string)
  const base: PouchDB.Core.ChangesOptions = {
    since,
    style: q.style === 'all_docs' ? 'all_docs' : 'main_only',
    include_docs: flag(q.include_docs),
    conflicts: flag(q.conflicts),
    attachments: flag(q.attachments),
    descending: flag(q.descending),
    ...(q.limit ? { limit: Number(q.limit) } : {}),
    ...(docIds ? { doc_ids: docIds } : {}),
  }
  const now = await db.changes(base)
  if (q.feed !== 'longpoll' || now.results.length > 0) return json(200, { results: now.results, last_seq: now.last_seq })

  // Nothing yet: wait for the first change, the client leaving, or the time limit.
  const waitMs = Math.min(longpollMaxMs, q.timeout ? Number(q.timeout) : longpollMaxMs)
  const next = await new Promise<PouchDB.Core.ChangesResponseChange<object>[]>((resolve) => {
    const feed = db.changes({ ...base, live: true, since: now.last_seq })
    const found: PouchDB.Core.ChangesResponseChange<object>[] = []
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', finish)
      feed.cancel()
      resolve(found)
    }
    const timer = setTimeout(finish, waitMs)
    request.signal?.addEventListener('abort', finish)
    feed.on('change', (change) => {
      found.push(change)
      // Let a burst land in one answer.
      setTimeout(finish, 20)
    })
    feed.on('error', finish)
  })
  const lastSeq = next.length > 0 ? next[next.length - 1]!.seq : now.last_seq
  return json(200, { results: next, last_seq: lastSeq })
}

export { createHostLogin, HOST_ACCOUNTS_DOC_ID, type HostAccount, type HostLogin, type HostLoginOptions } from './hostLogin.js'
