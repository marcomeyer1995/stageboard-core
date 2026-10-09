#!/usr/bin/env node
/**
 * Restores CouchDB databases from a backup generation written by scripts/backup.mjs (#363).
 *
 *   node scripts/backup-restore.mjs <generation-dir> <db|--all>
 *
 * Creates the database if needed, puts its `_security` back and writes every document with
 * `new_edits: false` - the stored revisions (and their history) come back exactly, so devices
 * that still have the band replicate against it as if nothing happened. Refuses to write into a
 * database that already has documents unless `--force` is given (merging revision trees is
 * what CouchDB does then, but it should be a deliberate step).
 *
 * Target CouchDB like core-backend: COUCHDB_URL / COUCHDB_USER / COUCHDB_PASSWORD.
 * Backing tracks etc.: unpack `data.tar.gz` next to the old data folder (see docs/03).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [generation, which, ...flags] = process.argv.slice(2)
const force = flags.includes('--force')
const couch = {
  url: (process.env.COUCHDB_URL ?? 'http://localhost:5984').replace(/\/$/, ''),
  auth: 'Basic ' + Buffer.from(`${process.env.COUCHDB_USER ?? 'admin'}:${process.env.COUCHDB_PASSWORD ?? 'admin'}`).toString('base64'),
}

async function request(method, path, body) {
  const res = await fetch(`${couch.url}${path}`, {
    method,
    headers: { Authorization: couch.auth, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function restore(file) {
  const dump = JSON.parse(readFileSync(file, 'utf8'))
  const db = encodeURIComponent(dump.db)
  const created = await request('PUT', `/${db}`)
  if (created.status !== 201 && created.status !== 412) throw new Error(`Could not create ${dump.db}: HTTP ${created.status}`)
  if (created.status === 412 && !force && dump.db !== '_users') {
    const info = await request('GET', `/${db}`)
    if (info.json.doc_count > 0) throw new Error(`${dump.db} already has ${info.json.doc_count} documents - add --force to merge`)
  }
  if (dump.security && Object.keys(dump.security).length > 0) await request('PUT', `/${db}/_security`, dump.security)
  // Design documents last: a validate_doc_update function (the band's roster validator) would
  // otherwise already judge the documents restored after it and reject some (found in the
  // restore test: one member profile went missing).
  const ordered = [...dump.docs.filter((d) => !d._id.startsWith('_design/')), ...dump.docs.filter((d) => d._id.startsWith('_design/'))]
  let written = 0
  const rejected = []
  for (let i = 0; i < ordered.length; i += 200) {
    const batch = ordered.slice(i, i + 200)
    const res = await request('POST', `/${db}/_bulk_docs`, { docs: batch, new_edits: false })
    if (res.status !== 201) throw new Error(`_bulk_docs into ${dump.db}: HTTP ${res.status}`)
    for (const result of Array.isArray(res.json) ? res.json : []) {
      if (result.error) rejected.push(`${result.id}: ${result.error}`)
    }
    written += batch.length
  }
  if (rejected.length > 0) throw new Error(`${dump.db}: ${rejected.length} documents rejected - ${rejected.slice(0, 3).join('; ')}`)
  console.log(JSON.stringify({ level: 'info', msg: 'Restored', db: dump.db, docs: written }))
}

async function main() {
  if (!generation || !which) throw new Error('Usage: backup-restore.mjs <generation-dir> <db|--all> [--force]')
  const dir = join(generation, 'couchdb')
  const files = which === '--all' ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [`${which}.json`]
  for (const file of files) await restore(join(dir, file))
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'Restore failed', error: err instanceof Error ? err.message : String(err) }))
  process.exitCode = 1
})
