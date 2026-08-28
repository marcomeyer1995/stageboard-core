import PouchDB from 'pouchdb-browser'
import { localDbName } from './workspaceDb'

/** Every workspace-scoped collection worth restoring. Deliberately excludes 'meta' (show
 * state + plugin health): both are live runtime state, not content a musician would want
 * to "restore" - a stale show position or heartbeat doesn't mean anything after import. */
const SNAPSHOT_COLLECTIONS = [
  'songs',
  'song-variants',
  'setlists',
  'dashboards',
  'profiles',
  'plugins',
  'showlog',
] as const

const SNAPSHOT_VERSION = 1

interface SnapshotDoc {
  _id: string
  _rev: string
  [key: string]: unknown
}

export interface WorkspaceSnapshot {
  version: number
  workspaceId: string
  exportedAt: string
  collections: Partial<Record<(typeof SNAPSHOT_COLLECTIONS)[number], SnapshotDoc[]>>
}

/** Reads every snapshot-eligible collection for a workspace, attachments included (base64 -
 * PouchDB's `binary: false` default), so a single JSON file is a complete, restorable dump. */
export async function buildWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
  const collections: WorkspaceSnapshot['collections'] = {}

  for (const kind of SNAPSHOT_COLLECTIONS) {
    const db = new PouchDB(localDbName(kind, workspaceId))
    const result = await db.allDocs({ include_docs: true, attachments: true })
    collections[kind] = result.rows
      .map((row) => row.doc)
      .filter((doc): doc is SnapshotDoc => doc !== undefined)
  }

  return { version: SNAPSHOT_VERSION, workspaceId, exportedAt: new Date().toISOString(), collections }
}

/** Triggers a browser download of the snapshot - no server round-trip, the file never
 * leaves the device unless the user moves it themselves. */
export function downloadWorkspaceSnapshot(snapshot: WorkspaceSnapshot): void {
  const json = JSON.stringify(snapshot, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  try {
    const date = snapshot.exportedAt.slice(0, 10)
    const link = document.createElement('a')
    link.href = url
    link.download = `stageboard-backup-${snapshot.workspaceId}-${date}.json`
    link.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Parses and shape-checks an uploaded file before anything touches PouchDB - a malformed
 * or foreign-version file should fail loudly here, not half-write into the local database. */
export function parseWorkspaceSnapshot(raw: string): WorkspaceSnapshot {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('Datei ist kein gültiges JSON.')
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('Ungültige Backup-Datei.')
  }
  const snapshot = data as Partial<WorkspaceSnapshot>
  if (snapshot.version !== SNAPSHOT_VERSION) {
    throw new Error(`Nicht unterstützte Backup-Version: ${String(snapshot.version)}`)
  }
  if (typeof snapshot.collections !== 'object' || snapshot.collections === null) {
    throw new Error('Backup-Datei enthält keine Daten.')
  }

  return snapshot as WorkspaceSnapshot
}

/** Bulk-writes a parsed snapshot back into the given workspace. Every document is matched
 * against whatever already exists locally by id and re-stamped with its current `_rev` (or
 * left new) instead of carrying over the exported `_rev` - that exported revision almost
 * certainly doesn't exist in the target database (a different workspace, or the same one
 * after further edits), and PouchDB rejects a `_rev` it doesn't recognize as a conflict. */
export async function restoreWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  workspaceId: string,
): Promise<void> {
  for (const kind of SNAPSHOT_COLLECTIONS) {
    const docs = snapshot.collections[kind]
    if (!docs || docs.length === 0) continue

    const db = new PouchDB(localDbName(kind, workspaceId))
    const existing = await db.allDocs()
    const revById = new Map(existing.rows.map((row) => [row.id, row.value.rev]))

    const prepared = docs.map((doc) => {
      const currentRev = revById.get(doc._id)
      const withoutRev: Partial<SnapshotDoc> = { ...doc }
      delete withoutRev._rev
      return currentRev ? { ...withoutRev, _rev: currentRev } : withoutRev
    })

    await db.bulkDocs(prepared)
  }
}
