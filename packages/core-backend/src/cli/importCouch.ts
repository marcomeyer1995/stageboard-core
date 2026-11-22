/**
 * Moves a band off CouchDB into the built-in database (#779): a copy, never a move - CouchDB is only read.
 *
 *   COUCHDB_URL=http://localhost:5984 COUCHDB_USER=... COUCHDB_PASSWORD=... \
 *   STAGEBOARD_DB_URL=https://... STAGEBOARD_DB_USER=... STAGEBOARD_DB_PASSWORD=... \
 *   npm run band:import-couch -w core-backend -- [<band id>] [--dry-run]
 *
 * Without a band id every `stageboard-*` database is copied. The target must be a different database than the source and must not have the band yet
 * (it never merges into or overwrites a band). The documents are copied by replication - revisions and history intact, so a tablet that already has the
 * band keeps syncing without a conflict. Then the band gets what the built-in host needs: the current roster validator, and the logins of CouchDB's
 * `_users` as `account:` / `anchor:` documents with the same PBKDF2 verifiers (nobody has to sign in again, no PIN changes).
 */
import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
import Replication from 'pouchdb-replication'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensureDb, listDbs, putDoc, putSecurity, type DatabaseConfig, type DatabaseDoc } from '../database.js'
import { ROSTER_VALIDATOR_SOURCE, workspaceDbName } from '../workspaceProvisioning.js'
import { serverDatabaseConfig } from './serviceEnv.js'

export interface CouchUser {
  _id: string
  name: string
  roles?: string[]
  type?: string
  password_scheme?: string
  pbkdf2_prf?: string
  iterations?: number
  salt?: string
  derived_key?: string
}

/** The band's logins as the built-in host keeps them. `skipped`: users of the band without a usable verifier. */
export function accountDocsOf(workspaceId: string, users: readonly CouchUser[]): { docs: DatabaseDoc[]; skipped: number } {
  const prefix = `${workspaceDbName(workspaceId)}-`
  const docs: DatabaseDoc[] = []
  let skipped = 0
  for (const user of users) {
    if (!user.name?.startsWith(prefix)) continue
    const rest = user.name.slice(prefix.length)
    if (rest === '') continue
    if (!user.salt || !user.derived_key || !user.iterations) {
      skipped += 1
      continue
    }
    const verifier = { iterations: user.iterations, salt: user.salt, derived_key: user.derived_key, pbkdf2_prf: user.pbkdf2_prf ?? 'sha256' }
    if (rest.includes('~')) docs.push({ _id: `account:${user.name}`, name: user.name, roles: user.roles ?? ['member'], ...verifier })
    else if ((user.roles ?? []).includes('admin')) docs.push({ _id: `anchor:${rest}`, profileId: rest, ...verifier })
  }
  return { docs, skipped }
}

const get = async (config: DatabaseConfig, path: string): Promise<unknown> => {
  const response = await fetch(`${config.url.replace(/\/$/, '')}/${path}`, { headers: { Authorization: `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}` } })
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`)
  return response.json()
}

function couchConfig(): DatabaseConfig {
  const file = join(homedir(), '.config', 'stageboard', 'couchdb.env')
  const fromFile: Record<string, string> = {}
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)=(.*)$/.exec(line)
    if (m) fromFile[m[1]!] = m[2]!.trim().replace(/^"|"$/g, '')
  }
  const pick = (k: string) => process.env[k] ?? fromFile[k]
  const user = pick('COUCHDB_USER')
  const password = pick('COUCHDB_PASSWORD')
  if (!user || !password) throw new Error('COUCHDB_USER / COUCHDB_PASSWORD are not set (and not in ~/.config/stageboard/couchdb.env)')
  return { url: pick('COUCHDB_URL') ?? 'http://localhost:5984', user, password }
}

async function main(): Promise<void> {
  PouchDB.plugin(HttpAdapter).plugin(Replication)
  const args = process.argv.slice(2)
  const dry = args.includes('--dry-run')
  const only = args.find((a) => !a.startsWith('--'))
  const source = couchConfig()
  const target = serverDatabaseConfig()
  if (!process.env.STAGEBOARD_DB_URL) throw new Error('STAGEBOARD_DB_URL is not set: name the built-in host\'s database explicitly - this tool never guesses where it writes.')
  if (source.url.replace(/\/$/, '') === target.url.replace(/\/$/, '')) throw new Error('The source and the target are the same database.')

  const allDbs = ((await get(source, '_all_dbs')) as string[]).filter((d) => d.startsWith('stageboard-'))
  const dbs = only ? allDbs.filter((d) => d === workspaceDbName(only)) : allDbs
  if (dbs.length === 0) throw new Error(only ? `No band "${only}" in CouchDB.` : 'No stageboard-* database in CouchDB.')
  const existing = new Set(await listDbs(target))
  const users = ((await get(source, '_users/_all_docs?include_docs=true')) as { rows: { doc?: CouchUser }[] }).rows.map((r) => r.doc).filter((d): d is CouchUser => !!d && d.type === 'user')

  for (const db of dbs) {
    const id = db.slice('stageboard-'.length)
    const info = (await get(source, db)) as { doc_count: number }
    const accounts = accountDocsOf(id, users)
    if (existing.has(db)) {
      console.log(`SKIP  ${db}: the target already has it (never merged or overwritten)`)
      continue
    }
    console.log(`${dry ? 'WOULD COPY' : 'COPY'}  ${db}: ${info.doc_count} documents, ${accounts.docs.filter((d) => d._id.startsWith('account:')).length} device logins, ${accounts.docs.filter((d) => d._id.startsWith('anchor:')).length} PIN anchors${accounts.skipped ? `, ${accounts.skipped} users without a verifier skipped` : ''}`)
    if (dry) continue
    await ensureDb(target, db)
    await putSecurity(target, db, { admins: { names: [], roles: ['admin'] }, members: { names: [], roles: ['member', 'admin'] } })
    const open = (c: DatabaseConfig) => new PouchDB(`${c.url.replace(/\/$/, '')}/${db}`, { auth: { username: c.user, password: c.password }, fetch: (i: RequestInfo | URL, o?: RequestInit) => globalThis.fetch(i, o) } as PouchDB.Configuration.RemoteDatabaseConfiguration)
    const result = await open(source).replicate.to(open(target))
    await putDoc(target, db, { _id: '_design/roster', validate_doc_update: ROSTER_VALIDATOR_SOURCE, ...(await (async () => { const d = (await get(target, `${db}/_design%2Froster`).catch(() => null)) as { _rev?: string } | null; return d?._rev ? { _rev: d._rev } : {} })()) })
    for (const doc of accounts.docs) await putDoc(target, db, doc)
    const copied = ((await get(target, db)) as { doc_count: number }).doc_count
    console.log(`DONE  ${db}: replicated ${result.docs_written} documents; the target now has ${copied} (source ${info.doc_count}, plus ${accounts.docs.length} login documents)`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
