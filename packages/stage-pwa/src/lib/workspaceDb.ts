import PouchDB from 'pouchdb-browser'
import { trackedSync, type TrackedSync } from './trackedSync'

/**
 * One CouchDB database per workspace, holding every document kind (songs, setlists,
 * dashboards, ...) discriminated by an `id:` prefix on each doc's CouchDB `_id` (see
 * workspaceCollection.ts). Replaces the previous one-database-per-collection model: every
 * collection used to run its own independent live `.sync()`, and once caught up, a live
 * PouchDB pull holds a permanently-open `_changes` long-poll connection to CouchDB. Chrome
 * caps concurrent connections per origin at 6 under HTTP/1.1 - which is all CouchDB can ever
 * speak, confirmed via TLS ALPN negotiation (no HTTP/2 support planned by the CouchDB
 * project) - so 8 independently-synced collections meant at least one was always starved of
 * a connection, permanently stuck reporting "active" (this is what caused the sync-status
 * indicator to get stuck on "Synchronisiere…" and never resolve). One database, one sync,
 * caps the connection requirement at a small constant regardless of how many document kinds
 * the app eventually grows to.
 */

export function localDbName(workspaceId: string): string {
  return `stageboard-${workspaceId}`
}

/** Rewrites VITE_COUCHDB_URL's final path segment to a workspace-scoped database name. */
export function remoteDbUrl(workspaceId: string): string | null {
  const base = import.meta.env.VITE_COUCHDB_URL as string | undefined
  if (!base) return null

  const url = new URL(base)
  const segments = url.pathname.split('/').filter(Boolean)
  segments[segments.length - 1] = localDbName(workspaceId)
  url.pathname = `/${segments.join('/')}`
  return url.toString()
}

export function remoteAuth(): { username: string; password: string } {
  return {
    username: import.meta.env.VITE_COUCHDB_USER as string,
    password: import.meta.env.VITE_COUCHDB_PASSWORD as string,
  }
}

/** PUTs the database into existence if it doesn't exist yet (mirrors scripts/setup-couchdb.sh). */
export async function ensureRemoteDbExists(url: string): Promise<void> {
  const { username, password } = remoteAuth()
  const headers = new Headers()
  if (username) headers.set('Authorization', `Basic ${btoa(`${username}:${password}`)}`)

  const response = await fetch(url, { method: 'PUT', headers })
  if (!response.ok && response.status !== 412) {
    throw new Error(`Failed to provision database at ${url}: HTTP ${response.status}`)
  }
}

let currentWorkspaceId: string | null = null
let db: PouchDB.Database<Record<string, unknown>> = new PouchDB(localDbName('default'))
let syncHandle: TrackedSync | null = null

/**
 * The one shared local PouchDB instance for a workspace - idempotent per `workspaceId`, so
 * every collection module and store can call this on every `init()` without redundantly
 * recreating it. Only actually swaps (and cancels any running sync, via `startWorkspaceSync`
 * being re-invoked by its own `useWorkspaceResource` caller) when the workspace truly changes.
 */
export function getWorkspaceDb<T extends object = Record<string, unknown>>(
  workspaceId: string,
): PouchDB.Database<T> {
  if (workspaceId !== currentWorkspaceId) {
    currentWorkspaceId = workspaceId
    db = new PouchDB(localDbName(workspaceId))
    // One local `.changes()` listener per collection is expected and correct now that they
    // all share this one db (7+ collections, plus show-state) - past Node's default
    // EventEmitter cap of 10. Raises the ceiling on this db instance's own emitter; PouchDB's
    // IndexedDB adapter also fans local changes out through its own internal per-db-name
    // emitter, which still logs the same advisory warning and isn't reachable from here -
    // confirmed harmless (Node's own docs: purely advisory, never throttles or throws), not
    // worth chasing into PouchDB's internals for a console message with no functional effect.
    // Optional call: test doubles for PouchDB (see workspaceCollection.test.ts et al.) don't
    // implement this, and don't need to - it's a console-noise fix for the real thing only.
    db.setMaxListeners?.(0)
  }
  return db as unknown as PouchDB.Database<T>
}

/**
 * The one and only live `.sync()` for the whole app - see the module doc comment above for
 * why this replaced 8 independent per-collection syncs. Called once from App.tsx.
 */
export function startWorkspaceSync(workspaceId: string): TrackedSync | null {
  const url = remoteDbUrl(workspaceId)
  if (!url) return null

  ensureRemoteDbExists(url).catch((err) => {
    console.error('Failed to provision remote workspace database', err)
  })

  const localDb = getWorkspaceDb(workspaceId)
  const remoteDb = new PouchDB(url, { auth: remoteAuth() })
  syncHandle = trackedSync('workspace', localDb, remoteDb)
  return syncHandle
}
