#!/usr/bin/env node
/**
 * Backup of a Stage-Server to a second medium (#363).
 *
 *   node scripts/backup.mjs <target-dir>          (or STAGEBOARD_BACKUP_TARGET=<dir>)
 *
 * Writes one dated generation `<target>/stageboard-YYYY-MM-DD_HHMM/` with
 * - `couchdb/<db>.json`: every document of every StageBoard database (and `_users`) with its
 *   revision history and attachments (`_bulk_get?revs=true&attachments=true`), deleted ones as
 *   tombstones, so a restore with `new_edits: false` keeps the revisions (scripts/backup-restore.mjs,
 *   docs/03 "Backup & Wiederherstellung");
 * - `data.tar.gz`: STAGEBOARD_DATA_DIR (default ~/stageboard-data: backing tracks, active band,
 *   plugins, app, Android signing key);
 * - `certs.tar.gz`: the server's TLS certificates (CERTS_DIR, default <repo>/certs);
 * - `manifest.json`: what is in it, with document counts and sizes.
 * Keeps the newest STAGEBOARD_BACKUP_KEEP generations (default 7) and deletes older ones - only
 * folders it created itself (`stageboard-…` with a manifest).
 *
 * Confidential: a generation holds the signing key, the TLS private key and every account's
 * password hash - keep the medium like a key ring. Written owner-only (0700 / 0600).
 *
 * Never silently skipped: a missing target (e.g. USB disk not mounted), a failed step or a full
 * disk ends with exit code 1, a JSON error line on stderr (journal) and `ok: false` in
 * `<STAGEBOARD_STATE_DIR>/backup-status.json`, which the app shows (Geräte → Stage-Server).
 *
 * CouchDB access like core-backend: COUCHDB_URL / COUCHDB_USER / COUCHDB_PASSWORD, otherwise the
 * same defaults. No credential is ever printed.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? process.env.STAGEBOARD_BACKUP_TARGET
const keep = Math.max(1, Number(process.env.STAGEBOARD_BACKUP_KEEP ?? 7))
const dataDir = process.env.STAGEBOARD_DATA_DIR ?? join(homedir(), 'stageboard-data')
const certsDir = process.env.CERTS_DIR ?? join(repoRoot, 'certs')
const stateDir = process.env.STAGEBOARD_STATE_DIR ?? dataDir
const couch = {
  url: (process.env.COUCHDB_URL ?? 'http://localhost:5984').replace(/\/$/, ''),
  auth: 'Basic ' + Buffer.from(`${process.env.COUCHDB_USER ?? 'admin'}:${process.env.COUCHDB_PASSWORD ?? 'admin'}`).toString('base64'),
}

function log(level, msg, extra = {}) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra })
  if (level === 'error') console.error(line)
  else console.log(line)
}

function writeStatus(status) {
  try {
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, 'backup-status.json'), JSON.stringify(status, null, 2))
  } catch (err) {
    log('error', 'Could not write backup-status.json', { error: String(err) })
  }
}

async function couchGet(path) {
  const res = await fetch(`${couch.url}${path}`, { headers: { Authorization: couch.auth } })
  if (!res.ok) throw new Error(`CouchDB GET ${path.split('?')[0]} -> HTTP ${res.status}`)
  return res.json()
}

async function couchPost(path, body) {
  const res = await fetch(`${couch.url}${path}`, {
    method: 'POST',
    headers: { Authorization: couch.auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`CouchDB POST ${path.split('?')[0]} -> HTTP ${res.status}`)
  return res.json()
}

/** Every document of one database with revision history and attachments. */
async function dumpDb(db) {
  // The changes feed, not _all_docs: it also lists deleted documents, whose tombstones must come
  // back on a restore - otherwise a device with an old copy would bring a deleted entry back.
  const changes = await couchGet(`/${encodeURIComponent(db)}/_changes?style=all_docs`)
  const docs = []
  const ids = [...new Set(changes.results.map((r) => r.id))]
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200).map((id) => ({ id }))
    const res = await couchPost(`/${encodeURIComponent(db)}/_bulk_get?revs=true&attachments=true`, { docs: batch })
    for (const result of res.results) {
      for (const entry of result.docs) {
        if (entry.ok) docs.push(entry.ok)
        else throw new Error(`CouchDB _bulk_get ${db}/${result.id}: ${entry.error?.error ?? 'unknown'}`)
      }
    }
  }
  const security = await couchGet(`/${encodeURIComponent(db)}/_security`).catch(() => ({}))
  return { db, security, docs }
}

function tarGz(sourceDir, file) {
  if (!existsSync(sourceDir)) throw new Error(`Folder to back up is missing: ${sourceDir}`)
  execFileSync('tar', ['-czf', file, '-C', dirname(sourceDir), basename(sourceDir)], { stdio: ['ignore', 'ignore', 'pipe'] })
  chmodSync(file, 0o600)
  return statSync(file).size
}

function pruneGenerations() {
  const generations = readdirSync(target)
    .filter((name) => /^stageboard-\d{4}-\d{2}-\d{2}_\d{4}$/.test(name) && existsSync(join(target, name, 'manifest.json')))
    .sort()
  const old = generations.slice(0, Math.max(0, generations.length - keep))
  for (const name of old) rmSync(join(target, name), { recursive: true, force: true })
  return old
}

async function main() {
  const startedAt = new Date()
  if (!target) throw new Error('No backup target - pass a folder or set STAGEBOARD_BACKUP_TARGET')
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Backup target is not there (not mounted?): ${target}`)
  }
  const stamp = startedAt.toISOString().slice(0, 16).replace('T', '_').replace(':', '')
  const dir = join(target, `stageboard-${stamp}`)
  mkdirSync(join(dir, 'couchdb'), { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)

  const dbs = (await couchGet('/_all_dbs')).filter((db) => db.startsWith('stageboard-') || db === '_users')
  const databases = []
  for (const db of dbs) {
    const dump = await dumpDb(db)
    const file = join(dir, 'couchdb', `${db}.json`)
    writeFileSync(file, JSON.stringify(dump), { mode: 0o600 })
    databases.push({ db, docs: dump.docs.length, bytes: statSync(file).size })
  }
  const dataBytes = tarGz(dataDir, join(dir, 'data.tar.gz'))
  const certsBytes = existsSync(certsDir) ? tarGz(certsDir, join(dir, 'certs.tar.gz')) : 0

  const manifest = {
    createdAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    databases,
    data: { source: dataDir, bytes: dataBytes },
    certs: { source: certsDir, bytes: certsBytes },
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  const removed = pruneGenerations()
  const totalBytes = databases.reduce((s, d) => s + d.bytes, 0) + dataBytes + certsBytes
  const status = { ok: true, at: startedAt.toISOString(), target, generation: basename(dir), totalBytes, databases: databases.length, removedGenerations: removed.length }
  writeStatus(status)
  log('info', 'Backup finished', status)
}

main().catch((err) => {
  const status = { ok: false, at: new Date().toISOString(), target: target ?? null, error: err instanceof Error ? err.message : String(err) }
  writeStatus(status)
  log('error', 'Backup failed', status)
  process.exitCode = 1
})
