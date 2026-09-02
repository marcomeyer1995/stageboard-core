import PouchDB from 'pouchdb-browser'
import { getStageServerUrl } from './stageServer'
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

/**
 * The workspace's remote CouchDB database URL, reached through core-backend's own origin
 * rather than CouchDB's own port directly (2026-09-02 fourth follow-up, at Marco's explicit
 * request). Browsers trust a self-signed cert per *origin*, not per-certificate - pointing
 * PouchDB at a *separate* CouchDB port meant every new device needed a second manual
 * "trotzdem fortfahren" tap beyond the one for the Stage-Server API/PWA itself
 * (docs/03 section 0a). core-backend's `/db` prefix (`index.ts`, `@fastify/http-proxy`) is a
 * pure passthrough - this device's own per-person Basic Auth (`startWorkspaceSync`'s `auth`
 * below) travels straight through to real CouchDB unmodified, so nothing about who can read or
 * write what changes; only the network hop does. `null` when no Stage-Server is configured at
 * all (Tier-A local-only-founding follow-up) - same as before.
 */
export function remoteDbUrl(workspaceId: string): string | null {
  const base = getStageServerUrl()
  if (!base) return null
  return `${base.replace(/\/$/, '')}/db/${localDbName(workspaceId)}`
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
 * why this replaced 8 independent per-collection syncs. Called once from App.tsx, gated
 * there on the active workspace's stored credentials already being present.
 *
 * `auth` is the workspace-scoped CouchDB user's credentials (see #12) - this device never
 * holds admin credentials, so unlike the old admin-authenticated version, it can no longer
 * create the remote database itself (CouchDB requires admin rights for that): the database
 * only ever comes into existence via scripts/setup-couchdb.sh or core-backend's
 * `POST /workspaces` route, both of which run with admin credentials.
 */
export function startWorkspaceSync(
  workspaceId: string,
  auth: { username: string; password: string },
): TrackedSync | null {
  const url = remoteDbUrl(workspaceId)
  if (!url) return null

  const localDb = getWorkspaceDb(workspaceId)
  const remoteDb = new PouchDB(url, { auth })
  syncHandle = trackedSync('workspace', localDb, remoteDb)
  return syncHandle
}
