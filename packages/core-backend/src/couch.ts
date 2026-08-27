/**
 * Minimal CouchDB client over Node's global fetch. Deliberately no dependency: the
 * Stage-Server only needs to read the replicated plugin documents and write its own
 * heartbeat, and docs/03 keeps this package lean on purpose.
 */
export interface CouchConfig {
  url: string
  user: string
  password: string
}

export interface CouchDoc {
  _id: string
  _rev?: string
  [field: string]: unknown
}

function authHeader({ user, password }: CouchConfig): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

export function dbUrl(config: CouchConfig, db: string): string {
  return `${config.url.replace(/\/$/, '')}/${encodeURIComponent(db)}`
}

async function request(
  config: CouchConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      Authorization: authHeader(config),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

/** Creates the database if it does not exist yet; an existing one (412) is fine. */
export async function ensureDb(config: CouchConfig, db: string): Promise<void> {
  const response = await request(config, dbUrl(config, db), { method: 'PUT' })
  if (!response.ok && response.status !== 412) {
    throw new Error(`Failed to create database ${db}: HTTP ${response.status}`)
  }
}

export async function allDocs<T>(config: CouchConfig, db: string): Promise<T[]> {
  const response = await request(config, `${dbUrl(config, db)}/_all_docs?include_docs=true`)
  if (!response.ok) throw new Error(`Failed to read ${db}: HTTP ${response.status}`)
  const body = (await response.json()) as { rows: Array<{ doc?: T }> }
  return body.rows.map((row) => row.doc).filter((doc): doc is T => doc !== undefined)
}

export async function getDoc<T extends CouchDoc>(
  config: CouchConfig,
  db: string,
  id: string,
): Promise<T | null> {
  const response = await request(config, `${dbUrl(config, db)}/${encodeURIComponent(id)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Failed to read ${db}/${id}: HTTP ${response.status}`)
  return (await response.json()) as T
}

export async function putDoc(config: CouchConfig, db: string, doc: CouchDoc): Promise<void> {
  const response = await request(config, `${dbUrl(config, db)}/${encodeURIComponent(doc._id)}`, {
    method: 'PUT',
    body: JSON.stringify(doc),
  })
  // 409 means another node wrote first; the next heartbeat re-reads and wins.
  if (!response.ok && response.status !== 409) {
    throw new Error(`Failed to write ${db}/${doc._id}: HTTP ${response.status}`)
  }
}

/** Downloads a binary attachment; `null` if the document or attachment does not exist. */
export async function getAttachment(
  config: CouchConfig,
  db: string,
  docId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  const url = `${dbUrl(config, db)}/${encodeURIComponent(docId)}/${encodeURIComponent(attachmentId)}`
  const response = await request(config, url)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Failed to read attachment ${db}/${docId}/${attachmentId}: HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Uploads a binary attachment, creating or overwriting it. `rev` is the current document
 * revision (required unless this is the very first write to a brand-new document) and is
 * not the attachment's own revision - CouchDB returns the document's new `_rev` on success.
 */
export async function putAttachment(
  config: CouchConfig,
  db: string,
  docId: string,
  attachmentId: string,
  rev: string | undefined,
  contentType: string,
  data: Buffer | Uint8Array,
): Promise<{ rev: string }> {
  const revQuery = rev ? `?rev=${encodeURIComponent(rev)}` : ''
  const url = `${dbUrl(config, db)}/${encodeURIComponent(docId)}/${encodeURIComponent(attachmentId)}${revQuery}`
  const response = await request(config, url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: data,
  })
  if (!response.ok) {
    throw new Error(`Failed to write attachment ${db}/${docId}/${attachmentId}: HTTP ${response.status}`)
  }
  const body = (await response.json()) as { ok: boolean; id: string; rev: string }
  return { rev: body.rev }
}

/**
 * Long-polls the changes feed. Long-poll rather than a continuous stream because it is a
 * plain request/response per change batch - no stream parsing, and a dropped connection
 * is just the next call.
 */
export async function waitForChange(
  config: CouchConfig,
  db: string,
  since: string,
  timeoutMs: number,
): Promise<{ lastSeq: string; changed: boolean }> {
  const url = `${dbUrl(config, db)}/_changes?feed=longpoll&since=${encodeURIComponent(since)}&timeout=${timeoutMs}`
  const response = await request(config, url)
  if (!response.ok) throw new Error(`Failed to poll ${db}: HTTP ${response.status}`)
  const body = (await response.json()) as { last_seq: string; results: unknown[] }
  return { lastSeq: body.last_seq, changed: body.results.length > 0 }
}
