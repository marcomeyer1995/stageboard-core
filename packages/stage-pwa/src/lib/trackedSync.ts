import { useSyncStore } from '../store/useSyncStore'

/**
 * Every workspace-scoped collection (songs, setlists, dashboards, ...) starts its own live
 * `.sync()` independently - there is no single PouchDB sync object anywhere (see #33). This
 * wraps `local.sync(remote, ...)` so all ~9 call sites report into the shared useSyncStore
 * the same way, instead of each duplicating its own change/paused/active/error listeners.
 *
 * `name` identifies the stream in the store (e.g. the collection's `kind`, or
 * 'plugin-health'); it just needs to be unique across the app's sync call sites.
 */
export function trackedSync<T extends object>(
  name: string,
  local: PouchDB.Database<T>,
  remote: PouchDB.Database<T>,
): PouchDB.Replication.Sync<T> {
  const { setStreamStatus, clearStream } = useSyncStore.getState()
  const sync = local.sync(remote, { live: true, retry: true })

  setStreamStatus(name, 'active')

  sync
    .on('active', () => setStreamStatus(name, 'active'))
    .on('change', () => setStreamStatus(name, 'active'))
    // PouchDB passes an `err` here specifically when a live sync paused because of a
    // disconnect (it will keep retrying under the hood); with no `err` it paused because
    // it's simply caught up, which is the "Synced" state from the Acceptance Criteria.
    .on('paused', (err) => setStreamStatus(name, err ? 'offline' : 'paused'))
    .on('error', () => setStreamStatus(name, 'error'))
    // Fires when a live sync is cancelled (e.g. switching workspace) - the stream is gone
    // for good at that point, so it should stop contributing to the aggregate status
    // rather than linger at whatever it last reported.
    .on('complete', () => clearStream(name))

  return sync
}
