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

/** Lists every database name on this CouchDB instance (2026-09-01, `GET /workspaces` - the
 * WiFi-style "which bands does this Stage-Server host" listing). Admin-only endpoint on
 * CouchDB's side; core-backend's own trusted config is the only caller. */
export async function listDbs(config: CouchConfig): Promise<string[]> {
  const response = await request(config, `${config.url.replace(/\/$/, '')}/_all_dbs`)
  if (!response.ok) throw new Error(`Failed to list databases: HTTP ${response.status}`)
  return (await response.json()) as string[]
}

/** Creates the database if it does not exist yet; an existing one (412) is fine. */
export async function ensureDb(config: CouchConfig, db: string): Promise<void> {
  const response = await request(config, dbUrl(config, db), { method: 'PUT' })
  if (!response.ok && response.status !== 412) {
    throw new Error(`Failed to create database ${db}: HTTP ${response.status}`)
  }
}

function userDocUrl(config: CouchConfig, username: string): string {
  return `${config.url.replace(/\/$/, '')}/_users/org.couchdb.user:${encodeURIComponent(username)}`
}

/** True if a CouchDB user with this name already exists (used to make provisioning idempotent
 * without ever silently rotating an existing user's password - see workspaceProvisioning.ts). */
export async function userExists(config: CouchConfig, username: string): Promise<boolean> {
  const response = await request(config, userDocUrl(config, username))
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Failed to check user ${username}: HTTP ${response.status}`)
  return true
}

/** Deletes the database - a no-op (not an error) if it's already gone. Irreversible: see
 * workspaceProvisioning.ts's `deprovisionWorkspace`, the only caller. */
export async function deleteDb(config: CouchConfig, db: string): Promise<void> {
  const response = await request(config, dbUrl(config, db), { method: 'DELETE' })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete database ${db}: HTTP ${response.status}`)
  }
}

/** Deletes the CouchDB user document - a no-op if it doesn't exist. CouchDB requires a
 * document's current `_rev` to delete it, so this looks the doc up first. */
export async function deleteUser(config: CouchConfig, username: string): Promise<void> {
  const getResponse = await request(config, userDocUrl(config, username))
  if (getResponse.status === 404) return
  if (!getResponse.ok) throw new Error(`Failed to look up user ${username}: HTTP ${getResponse.status}`)
  const doc = (await getResponse.json()) as { _rev: string }

  const deleteResponse = await request(config, `${userDocUrl(config, username)}?rev=${encodeURIComponent(doc._rev)}`, {
    method: 'DELETE',
  })
  if (!deleteResponse.ok && deleteResponse.status !== 404) {
    throw new Error(`Failed to delete user ${username}: HTTP ${deleteResponse.status}`)
  }
}

/**
 * Confirms `username`/`password` genuinely authenticate against CouchDB as that exact user, and
 * returns their roles (see per-person-accounts follow-up - callers check for `'admin'` in the
 * returned roles rather than comparing against one hardcoded username). `null` if the
 * credentials don't check out. Deliberately doesn't use `request()`/`authHeader()` above: those
 * always authenticate as `config`'s own trusted admin credentials, never a caller-supplied pair
 * - this is the one place core-backend authenticates as someone else's identity, so it builds
 * its own Basic auth header rather than risk that distinction getting blurred later.
 */
export async function verifyUser(
  config: CouchConfig,
  username: string,
  password: string,
): Promise<{ name: string; roles: string[] } | null> {
  const response = await fetch(`${config.url.replace(/\/$/, '')}/_session`, {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
  })
  if (!response.ok) return null
  const body = (await response.json()) as { userCtx?: { name?: string | null; roles?: string[] } }
  if (body.userCtx?.name !== username) return null
  return { name: username, roles: body.userCtx.roles ?? [] }
}

/** Creates a CouchDB user document with the given roles (see per-person-accounts follow-up -
 * `roles` is what `_design/roster`'s static validator and `_security`'s role-based grants key
 * off, not this user's name). Requires admin credentials in `config` - only `core-backend`
 * itself calls this (its own admin `couch` config, see index.ts), never the PWA. A 409 (user
 * already exists) is swallowed so re-provisioning never rotates a password out from under an
 * already-paired tablet. */
export async function createUser(config: CouchConfig, username: string, password: string, roles: string[] = []): Promise<void> {
  const response = await request(config, userDocUrl(config, username), {
    method: 'PUT',
    body: JSON.stringify({
      _id: `org.couchdb.user:${username}`,
      name: username,
      password,
      roles,
      type: 'user',
    }),
  })
  if (!response.ok && response.status !== 409) {
    throw new Error(`Failed to create user ${username}: HTTP ${response.status}`)
  }
}

type UserDoc = CouchDoc & { name: string; password?: string; type: string }

/** Shared fetch-then-PUT for updating one field on an existing user doc (CouchDB requires the
 * doc's current `_rev` to update it) - retries on HTTP 409 by re-fetching a fresh `_rev` and
 * trying again, up to 5 times. Confirmed live (#21 tenth follow-up): two devices reactivating
 * the *same* shared/admin account within milliseconds of each other (e.g. both racing the
 * universal recovery code right after joining) both read the same `_rev`, so the second write
 * is guaranteed to conflict - there's no real merge to reason about for either roles or
 * password here, a fresh re-read always resolves it. Throws if the user doesn't exist -
 * callers already know it does (they just authenticated as it, or looked it up), so a 404 here
 * means something else is wrong, not a case to swallow. */
async function updateUserDoc(config: CouchConfig, username: string, update: (doc: UserDoc) => UserDoc): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const getResponse = await request(config, userDocUrl(config, username))
    if (!getResponse.ok) throw new Error(`Failed to look up user ${username}: HTTP ${getResponse.status}`)
    const doc = (await getResponse.json()) as UserDoc

    const putResponse = await request(config, userDocUrl(config, username), {
      method: 'PUT',
      body: JSON.stringify(update(doc)),
    })
    if (putResponse.ok) return
    if (putResponse.status !== 409 || attempt === 5) {
      throw new Error(`Failed to update user ${username}: HTTP ${putResponse.status}`)
    }
  }
}

/** Overwrites an existing CouchDB user's roles (grant/revoke admin - see per-person-accounts
 * follow-up). */
export async function setUserRoles(config: CouchConfig, username: string, roles: string[]): Promise<void> {
  await updateUserDoc(config, username, (doc) => ({ ...doc, roles }))
}

/** Overwrites an existing CouchDB user's password (admin "reset password if forgotten" - see
 * BandManagementView.tsx's "Einladen" - and every silent reissue on join/activate, see
 * resolveOutcome in index.ts). This is the one place an existing account's password *does* get
 * rotated - unlike `createUser`, which deliberately never does. The caller accepts the
 * consequence: any device already synced with the old password stops authenticating until it's
 * re-invited/re-activated with the new one. */
export async function resetUserPassword(config: CouchConfig, username: string, newPassword: string): Promise<void> {
  await updateUserDoc(config, username, (doc) => ({ ...doc, password: newPassword }))
}

export interface CouchSecurityDoc {
  /** Database-level admins (see #56) - can administer this one database (e.g. change its own
   * `_security`), still scoped to just this database, not server admins. NOT automatically
   * exempt from `validate_doc_update` the way a true server admin is (verified live against a
   * real CouchDB instance) - workspaceProvisioning.ts's roster validator checks `userCtx.roles`
   * explicitly rather than relying on that.
   *
   * Per-person-accounts follow-up: `.names` stays empty forever on both - every workspace user
   * gets in purely via `.roles` (every CouchDB user for this workspace is created with
   * `roles: ['member']`, or `['member', 'admin']` for a band admin), so adding/removing a
   * member never means touching this doc again after the workspace is founded. */
  admins?: { names: string[]; roles: string[] }
  members: { names: string[]; roles: string[] }
}

/** Restricts a database's non-admin access to exactly the given security doc's members (see
 * #12 - each workspace database is locked to its own single CouchDB user this way). */
export async function putSecurity(config: CouchConfig, db: string, securityDoc: CouchSecurityDoc): Promise<void> {
  const response = await request(config, `${dbUrl(config, db)}/_security`, {
    method: 'PUT',
    body: JSON.stringify(securityDoc),
  })
  if (!response.ok) {
    throw new Error(`Failed to set security for ${db}: HTTP ${response.status}`)
  }
}

/** `startkey`/`endkey` scope the read to an id-prefix range - CouchDB's `_all_docs`
 * supports this natively, no secondary index needed (see workspaceCollection.ts's client
 * equivalent, which uses the same prefix scheme for the same reason: several document kinds
 * now share one physical database, see #49 follow-up). */
export async function allDocs<T>(
  config: CouchConfig,
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

/** Fetch-then-PUT for a doc that might already exist and might be concurrently written by
 * another caller - same conflict-retry shape as `updateUserDoc` above (re-fetches a fresh
 * `_rev` and retries, up to 5 times), generalized to any doc rather than just a user doc.
 * Unlike plain `putDoc`, a 409 here is actually retried rather than silently swallowed: for a
 * doc with no other re-writer (no "next heartbeat" to eventually win), swallowing a conflict
 * would leave the doc looking successfully written while it silently never changed. `build`
 * receives the doc's current state (`null` if it doesn't exist yet) and returns the full
 * document to write. */
export async function putDocWithRetry<T extends CouchDoc>(
  config: CouchConfig,
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
