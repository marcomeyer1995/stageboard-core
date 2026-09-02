import { getWorkspaceDb } from './workspaceDb'

/** The one `workspace:access` doc living in a workspace's shared CouchDB database (see
 * core-backend's `workspaceProvisioning.ts`) - holds the standing access code and, since #58,
 * the workspace's real display name. Read-only from the client side on purpose: renaming goes
 * through `useWorkspaceStore.ts`'s `renameWorkspace` (an admin-verified HTTP call to
 * core-backend), never a direct PouchDB write here, so a plain member's device can't spoof the
 * band name or access code just because it happens to share write access to the same db. */
const ACCESS_DOC_ID = 'workspace:access'

interface WorkspaceAccessDoc {
  code: string
  name: string
}

/** One-shot read of the given workspace's own `workspace:access` doc - `null` if this
 * workspace has never had one (a local-only, never-server-connected band, or a very old one
 * that predates the doc and hasn't been lazily backfilled server-side yet). */
export async function getWorkspaceAccessDoc(workspaceId: string): Promise<WorkspaceAccessDoc | null> {
  try {
    const doc = await getWorkspaceDb<WorkspaceAccessDoc>(workspaceId).get(ACCESS_DOC_ID)
    return { code: doc.code, name: doc.name }
  } catch {
    return null
  }
}

/** Live-watches just this one doc for remote changes (e.g. another admin device renaming the
 * band) - filtered via `doc_ids` rather than `workspaceCollection.ts`'s usual id-prefix filter
 * since there's only ever this single doc, no `kind:` range to scope. Local-only, no network
 * call of its own: rides whatever live sync `workspaceDb.ts`'s `startWorkspaceSync` already has
 * running against this same local db. */
export function watchWorkspaceAccessDoc(
  workspaceId: string,
  onChange: (doc: WorkspaceAccessDoc) => void,
): PouchDB.Core.Changes<WorkspaceAccessDoc> {
  return getWorkspaceDb<WorkspaceAccessDoc>(workspaceId)
    .changes({ since: 'now', live: true, include_docs: true, doc_ids: [ACCESS_DOC_ID] })
    .on('change', (change) => {
      if (change.doc) onChange({ code: change.doc.code, name: change.doc.name })
    })
}
