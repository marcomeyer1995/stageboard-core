import { getWorkspaceDb } from './workspaceDb'
import { configLog } from './configDebug'

export type Doc<T> = T & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta

export interface WorkspaceCollection<T extends { id: string }> {
  getDb: () => PouchDB.Database<T>
  switchWorkspace: (workspaceId: string) => PouchDB.Database<T>
  getAll: () => Promise<Doc<T>[]>
  put: (doc: T) => Promise<void>
  /**
   * A true read-modify-write, unlike `put()` (which always writes exactly the `doc` object
   * given to it): `patch` receives the *freshly re-read* current document on every attempt,
   * including retries. Use this instead of "read from the Zustand store, spread it, put()"
   * for any field that can plausibly change from two places close together (a config panel
   * with several independently-debounced fields, e.g.) - reading from the store risks a
   * stale in-memory snapshot that silently overwrites a concurrent change with old data even
   * when the write itself succeeds with no conflict at all (see `docId`'s sibling comment on
   * `put` for the "conflict that gets dropped" half of this same class of bug - this is the
   * other half, the one a conflict retry alone doesn't fix). No-ops if the document doesn't
   * exist - there's nothing sensible to patch.
   */
  update: (id: string, patch: (current: T) => T) => Promise<void>
  /** Deleting a missing document is a no-op, so callers don't have to check first. */
  remove: (id: string) => Promise<void>
  /** Local-only, filtered to this collection's own docs - the shared workspace db holds
   * every kind, so an unfiltered `.changes()` would fire on every other collection's writes
   * too. Costs nothing over the network: this queries the local PouchDB directly, it isn't
   * the remote sync (see workspaceDb.ts's startWorkspaceSync for that). */
  changes: (options: PouchDB.Core.ChangesOptions) => PouchDB.Core.Changes<T>
  /** The CouchDB `_id` a given application-level id maps to in the shared db - for the rare
   * call site that needs to reach the raw db directly (an attachment op, a doc patch) rather
   * than going through get/put/remove above. */
  docId: (id: string) => string
}

/** A rejected `db.put()` whose revision precondition lost a race, not a real failure - the
 * standard PouchDB/CouchDB shape for "someone else wrote this document since you read it". */
function isConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 409
}

const MAX_PUT_RETRIES = 5

/**
 * Same-process serialization, one queue per document id - same pattern as trackedSync.ts's
 * `startQueue`, applied per-document instead of globally. Root-caused live (Marco,
 * 2026-09-14, via configDebug.ts instrumentation): several independently-debounced widget-
 * config sliders (or even one slider dragged at a pace a bit slower than the 150ms debounce
 * window, so nearly every tick flushes on its own) each fire their own `update()` call. With
 * no serialization, N of those land concurrently against the *same* document - every one
 * reads the same starting `_rev`, so all but one immediately 409, and their retries then
 * collide with each other's retries too. The retry storm this produces isn't just slow: it
 * visibly replays every intermediate value to the UI as each write eventually wins its race,
 * spread over anywhere from several seconds to (observed live) 30-40+ seconds, and can even
 * exhaust MAX_PUT_RETRIES and silently drop a write outright (an unhandled rejection, no
 * user-visible error). Queuing same-process writes to one document means the common case -
 * this tab's own writers - essentially never conflicts at all: each write only starts once
 * the previous one has actually landed, so it reads the true latest `_rev`. Conflicts from
 * *outside* this queue (another tab, a remote CouchDB pull racing a local write) still reach
 * writeWithConflictRetry's own retry loop below - that defense stays exactly as it was, this
 * is a layer in front of it, not a replacement for it.
 */
const writeQueues = new Map<string, Promise<void>>()

function queuedWrite<T extends { id: string }>(
  db: PouchDB.Database<T>,
  cdbId: string,
  patch: (current: T | null) => T | null,
): Promise<void> {
  const previous = writeQueues.get(cdbId) ?? Promise.resolve()
  // One write's failure must not jam every write queued behind it for the same doc - each
  // still gets its own chance (and its own caller-visible rejection if it, too, fails).
  const next = previous.catch(() => undefined).then(() => writeWithConflictRetry(db, cdbId, patch))
  writeQueues.set(cdbId, next)
  void next.finally(() => {
    if (writeQueues.get(cdbId) === next) writeQueues.delete(cdbId)
  })
  return next
}

/**
 * Read-current-then-write, retried on a 409 instead of just letting it reject - and, unlike
 * a naive retry that just re-sends the same content with a fresher `_rev`, re-derives *what*
 * to write from the freshly re-read document on every attempt via `patch`. Historically (see
 * `queuedWrite` above for how this call site is now reached) two nearly-simultaneous writes
 * to the *same* document used to race two different ways:
 * - The losing `db.put()` rejects with a 409 (stale `_rev`) and - since every call site here
 *   fires this via `void save(...)`/`void update(...)`, fire-and-forget, no `.catch()` - that
 *   write silently vanished. Retrying at all fixes this half.
 * - Even *without* a rejection, `put()` always writes exactly the caller-given `doc` - a
 *   caller that built `doc` by spreading a Zustand-cached snapshot (`{...active, ...}`, the
 *   original shape of Dashboard.tsx's `updateConfig`) can win the race with a perfectly valid
 *   fresh `_rev` while still overwriting a *different* concurrent field-level change with
 *   stale data, no conflict raised at all. `update()`'s `patch` fixes this half: it receives
 *   the real current document - including whatever a just-landed concurrent write already
 *   changed - on every attempt, so a retry re-applies the same *intent* ("set this one field")
 *   against the latest state instead of blindly re-sending a stale full snapshot.
 * (Both found together, Marco 2026-09-14: a Prompter config slider "jumping back and forth".
 * The retry loop below only ever fixed the symptom for a *rare* conflict - it made a losing
 * write eventually land instead of vanishing, but did nothing to stop same-process writes
 * from racing each other in the first place. The actual "jumps for 30-40 seconds" cause was
 * `queuedWrite`'s: with no serialization, every debounced slider commit fired its own
 * concurrent read-then-write, so *most* of them conflicted, and their retries collided with
 * each other too - a storm that visibly replayed every intermediate value to the UI. This
 * loop is now reached one write at a time per document via that queue, so it should rarely
 * see a 409 at all in the common same-tab case; it remains the correct fallback for a
 * genuine cross-context conflict - another tab, or a remote CouchDB pull landing mid-write.)
 * Bounded retries, so a document that's *genuinely* stuck (not just transiently racing)
 * doesn't retry forever.
 */
async function writeWithConflictRetry<T extends { id: string }>(
  db: PouchDB.Database<T>,
  cdbId: string,
  patch: (current: T | null) => T | null,
  attempt = 0,
): Promise<void> {
  const existing = await db.get(cdbId).catch(() => null)
  configLog('writeWithConflictRetry', cdbId, 'attempt', attempt, 'existing rev', existing?._rev ?? '(none)')
  const nextDoc = patch(existing as T | null)
  if (nextDoc === null) {
    configLog('writeWithConflictRetry', cdbId, 'patch returned null (no doc to update) - skipping write')
    return
  }

  // A revision's _attachments is only carried forward if the new body explicitly repeats
  // the stub metadata - callers here only ever pass the plain content fields, so without
  // this, saving e.g. a song's title after attaching a backing track would silently delete
  // the attachment.
  const putDoc = existing
    ? { ...nextDoc, _id: cdbId, _rev: existing._rev, _attachments: existing._attachments }
    : { ...nextDoc, _id: cdbId }
  try {
    await db.put(putDoc as PouchDB.Core.PutDocument<T>)
    configLog('writeWithConflictRetry', cdbId, 'attempt', attempt, 'put() succeeded')
  } catch (err) {
    const conflict = isConflict(err)
    configLog('writeWithConflictRetry', cdbId, 'attempt', attempt, 'put() failed, conflict:', conflict, err)
    if (conflict && attempt < MAX_PUT_RETRIES) {
      await writeWithConflictRetry(db, cdbId, patch, attempt + 1)
      return
    }
    throw err
  }
}

/**
 * A workspace-scoped view over the one shared per-workspace CouchDB database (see
 * workspaceDb.ts) - `kind` prefixes every document's CouchDB `_id` (`${kind}:${doc.id}`) so
 * many document kinds can share one database (and therefore one live sync connection)
 * without colliding, while `_all_docs`' native `startkey`/`endkey` range query scopes reads
 * to just this kind - no secondary index needed. The document body's own `id` field (what
 * every `toX()` mapper actually reads) was already separate from CouchDB's `_id` before this
 * change, so nothing downstream of getAll/put/remove needs to know prefixing exists at all.
 */
export function createWorkspaceCollection<T extends { id: string }>(
  kind: string,
): WorkspaceCollection<T> {
  const prefix = `${kind}:`
  const docId = (id: string) => `${prefix}${id}`
  let db = getWorkspaceDb<T>('default')

  return {
    getDb: () => db,
    docId,

    switchWorkspace: (workspaceId) => {
      db = getWorkspaceDb<T>(workspaceId)
      return db
    },

    getAll: async () => {
      const result = await db.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}￰`,
      })
      return result.rows.map((row) => row.doc).filter((doc): doc is Doc<T> => doc !== undefined)
    },

    put: (doc) => queuedWrite(db, docId(doc.id), () => doc),

    update: (id, patch) => queuedWrite(db, docId(id), (current) => (current ? patch(current) : null)),

    remove: async (id) => {
      const existing = await db.get(docId(id)).catch(() => null)
      if (!existing) return
      await db.remove(existing)
    },

    changes: (options) =>
      db.changes({
        ...options,
        filter: (doc) => doc._id.startsWith(prefix),
      }),
  }
}
