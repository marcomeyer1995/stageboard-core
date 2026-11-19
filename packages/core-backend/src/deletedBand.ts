import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dbUrl, type CouchConfig } from './couch.js'
import { workspaceDbName } from 'sync-host'

/**
 * Keeps a band that is about to be deleted (#362: a deleted band stays recoverable). The old CouchDB kept deleted
 * databases as files; the built-in database host destroys them, so every delete writes a copy first - all documents and
 * the access rules - in the format of `scripts/backup.mjs`, so `scripts/backup-restore.mjs <dir> <db>` brings the band
 * back. Without revision history (the current documents only). The copy holds logins and the access code: owner only.
 * Returns the file, or null when there is no such database (nothing to keep).
 */
export async function saveDeletedBand(config: CouchConfig, workspaceId: string, stateDir: string, now: () => Date = () => new Date()): Promise<string | null> {
  const db = workspaceDbName(workspaceId)
  const authorization = `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`
  const get = (path: string) => fetch(`${dbUrl(config, db)}${path}`, { headers: { Authorization: authorization } })

  const all = await get('/_all_docs?include_docs=true&attachments=true')
  if (all.status === 404) return null
  if (!all.ok) throw new Error(`Could not copy ${db} before deleting it: HTTP ${all.status}`)
  const docs = ((await all.json()) as { rows: { doc?: unknown }[] }).rows.flatMap((row) => (row.doc ? [row.doc] : []))
  const security = await get('/_security').then((r) => (r.ok ? r.json() : {}), () => ({}))

  const stamp = now().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
  const generation = join(stateDir, 'deleted-bands', `${db}-${stamp}`)
  const dir = join(generation, 'couchdb')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `${db}.json`)
  writeFileSync(file, JSON.stringify({ db, security, docs }), { mode: 0o600 })
  return file
}
