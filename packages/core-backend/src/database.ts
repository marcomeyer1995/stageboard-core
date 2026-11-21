/**
 * Minimal the database client over Node's global fetch. Deliberately no dependency: the
 * Host only needs to read the replicated plugin documents and write its own
 * heartbeat, and docs/03 keeps this package lean on purpose.
 */
export interface DatabaseConfig {
  url: string
  user: string
  password: string
}

export interface DatabaseDoc {
  _id: string
  _rev?: string
  [field: string]: unknown
}

function authHeader({ user, password }: DatabaseConfig): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

export function dbUrl(config: DatabaseConfig, db: string): string {
  return `${config.url.replace(/\/$/, '')}/${encodeURIComponent(db)}`
}

async function request(
  config: DatabaseConfig,
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

/** Lists every database name on this the database instance (2026-09-01, `GET /workspaces` - the
 * WiFi-style "which bands does this Host host" listing). Admin-only endpoint on
 * the database's side; core-backend's own trusted config is the only caller. */
export async function listDbs(config: DatabaseConfig): Promise<string[]> {
  const response = await request(config, `${config.url.replace(/\/$/, '')}/_all_dbs`)
  if (!response.ok) throw new Error(`Failed to list databases: HTTP ${response.status}`)
  return (await response.json()) as string[]
}

/** Creates the database if it does not exist yet; an existing one (412) is fine. */
export async function ensureDb(config: DatabaseConfig, db: string): Promise<void> {
  const response = await request(config, dbUrl(config, db), { method: 'PUT' })
  if (!response.ok && response.status !== 412) {
    throw new Error(`Failed to create database ${db}: HTTP ${response.status}`)
  }
}

/** Deletes the database - a no-op (not an error) if it's already gone. Irreversible: see
 * workspaceProvisioning.ts's `deprovisionWorkspace`, the only caller. */
export async function deleteDb(config: DatabaseConfig, db: string): Promise<void> {
  const response = await request(config, dbUrl(config, db), { method: 'DELETE' })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete database ${db}: HTTP ${response.status}`)
  }
}

export interface DatabaseSecurityDoc {
  /** Database-level admins (see #56) - can administer this one database (e.g. change its own
   * `_security`), still scoped to just this database, not server admins. NOT automatically
   * exempt from `validate_doc_update` the way a true server admin is (verified live against a
   * real the database instance) - workspaceProvisioning.ts's roster validator checks `userCtx.roles`
   * explicitly rather than relying on that.
   *
   * Per-person-accounts follow-up: `.names` stays empty forever on both - every workspace user
   * gets in purely via `.roles` (every database login for this workspace is created with
   * `roles: ['member']`, or `['member', 'admin']` for a band admin), so adding/removing a
   * member never means touching this doc again after the workspace is founded. */
  admins?: { names: string[]; roles: string[] }
  members: { names: string[]; roles: string[] }
}

/** Restricts a database's non-admin access to exactly the given security doc's members (see
 * #12 - each workspace database is locked to its own single database login this way). */
export async function putSecurity(config: DatabaseConfig, db: string, securityDoc: DatabaseSecurityDoc): Promise<void> {
  const response = await request(config, `${dbUrl(config, db)}/_security`, {
    method: 'PUT',
    body: JSON.stringify(securityDoc),
  })
  if (!response.ok) {
    throw new Error(`Failed to set security for ${db}: HTTP ${response.status}`)
  }
}

/** `startkey`/`endkey` scope the read to an id-prefix range - the database's `_all_docs`
 * supports this natively, no secondary index needed (see workspaceCollection.ts's client
 * equivalent, which uses the same prefix scheme for the same reason: several document kinds
 * now share one physical database, see #49 follow-up). */
export async function allDocs<T>(
  config: DatabaseConfig,
  db: string,
  options: { startkey?: string; endkey?: string } = {},
): Promise<T[]> {
  const params = new URLSearchParams({ include_docs: 'true' })
  if (options.startkey !== undefined) params.set('startkey', JSON.stringify(options.startkey))
  if (options.endkey !== undefined) params.set('endkey', JSON.stringify(options.endkey))

  const response = await request(config, `${dbUrl(config, db)}/_all_docs?${params.toString()}`)
  if (!response.ok) throw new Error(`Failed to read ${db}: HTTP ${response.status}`)
  const body = (await response.json()) as { rows: Array<{ doc?: T }> }
  return body.rows.map((row) => row.doc).filter((doc): doc is T => doc !== undefined)
}

export async function getDoc<T extends DatabaseDoc>(
  config: DatabaseConfig,
  db: string,
  id: string,
): Promise<T | null> {
  const response = await request(config, `${dbUrl(config, db)}/${encodeURIComponent(id)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Failed to read ${db}/${id}: HTTP ${response.status}`)
  return (await response.json()) as T
}

export async function putDoc(config: DatabaseConfig, db: string, doc: DatabaseDoc): Promise<void> {
  const response = await request(config, `${dbUrl(config, db)}/${encodeURIComponent(doc._id)}`, {
    method: 'PUT',
    body: JSON.stringify(doc),
  })
  // 409 means another node wrote first; the next heartbeat re-reads and wins.
  if (!response.ok && response.status !== 409) {
    throw new Error(`Failed to write ${db}/${doc._id}: HTTP ${response.status}`)
  }
}

/** Fetch-then-PUT for a doc that might already exist and might be concurrently written by
 * another caller - same conflict-retry shape as `updateUserDoc` above (re-fetches a fresh
 * `_rev` and retries, up to 5 times), generalized to any doc rather than just a user doc.
 * Unlike plain `putDoc`, a 409 here is actually retried rather than silently swallowed: for a
 * doc with no other re-writer (no "next heartbeat" to eventually win), swallowing a conflict
 * would leave the doc looking successfully written while it silently never changed. `build`
 * receives the doc's current state (`null` if it doesn't exist yet) and returns the full
 * document to write. */
export async function putDocWithRetry<T extends DatabaseDoc>(
  config: DatabaseConfig,
  db: string,
  id: string,
  build: (existing: T | null) => T,
): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const existing = await getDoc<T>(config, db, id)
    const response = await request(config, `${dbUrl(config, db)}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(build(existing)),
    })
    if (response.ok) return
    if (response.status !== 409 || attempt === 5) {
      throw new Error(`Failed to write ${db}/${id}: HTTP ${response.status}`)
    }
  }
}

/**
 * Deletes `id` unless `refuse(existing)` names a reason not to. The check and the delete use the
 * same revision: on a write conflict it reads again and checks again (up to 5 times), so a
 * concurrent change is never ignored the way `putDoc` ignores a 409. Returns 'deleted', 'missing'
 * (no such doc) or the reason.
 */
export async function deleteDocUnless<T extends DatabaseDoc, R extends string>(
  config: DatabaseConfig,
  db: string,
  id: string,
  refuse: (existing: T) => R | null,
): Promise<'deleted' | 'missing' | R> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const existing = await getDoc<T>(config, db, id)
    if (!existing) return 'missing'
    const reason = refuse(existing)
    if (reason !== null) return reason
    const response = await request(config, `${dbUrl(config, db)}/${encodeURIComponent(id)}?rev=${encodeURIComponent(existing._rev ?? '')}`, { method: 'DELETE' })
    if (response.ok) return 'deleted'
    if (response.status === 404) return 'missing'
    if (response.status !== 409 || attempt === 5) {
      throw new Error(`Failed to delete ${db}/${id}: HTTP ${response.status}`)
    }
  }
  throw new Error(`Failed to delete ${db}/${id}`)
}

/**
 * Long-polls the changes feed. Long-poll rather than a continuous stream because it is a
 * plain request/response per change batch - no stream parsing, and a dropped connection
 * is just the next call.
 */
export async function waitForChange(
  config: DatabaseConfig,
  db: string,
  since: string,
  timeoutMs: number,
): Promise<{ lastSeq: string; changed: boolean; ids: string[] }> {
  const url = `${dbUrl(config, db)}/_changes?feed=longpoll&since=${encodeURIComponent(since)}&timeout=${timeoutMs}`
  const response = await request(config, url)
  if (!response.ok) throw new Error(`Failed to poll ${db}: HTTP ${response.status}`)
  const body = (await response.json()) as { last_seq: string; results: Array<{ id: string }> }
  return { lastSeq: body.last_seq, changed: body.results.length > 0, ids: body.results.map((r) => r.id) }
}
