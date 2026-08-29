import { useSyncStore } from '../store/useSyncStore'

/** A cancellable handle - safe to cancel whether the underlying sync has actually started
 * yet (see the queue below) or not. */
export interface TrackedSync {
  cancel(): void
}

/**
 * Gates when each of the ~9 independent live PouchDB<->CouchDB streams (songs, setlists,
 * dashboards, ...) actually calls `.sync()`. Starting all of them at once means their
 * initial provisioning + first-changes-check requests all fire simultaneously against the
 * same CouchDB host - easily more than the browser's ~6-connections-per-host limit for
 * plain HTTP/1.1, so several streams never even get a response and sit reporting 'active'
 * forever (see #33's follow-up: the sync indicator never left "Synchronisiere…"). Each
 * queued stream now waits for the previous one to reach its first settled state (paused,
 * offline, error, or cancelled) before it gets its turn.
 */
let startQueue: Promise<void> = Promise.resolve()

/** Test-only: the queue is module-level (one shared queue for the whole app, by design),
 * so tests need a way to stop one test's queued streams from blocking the next test's. */
export function __resetSyncQueueForTests(): void {
  startQueue = Promise.resolve()
}

export interface TrackedSyncOptions {
  /**
   * Marks a changed doc id as background noise rather than a real user-visible change - for
   * a doc that writes far more often than any real user action would, faster than the
   * changes feed's own idle window, so 'paused' may rarely or never fire natively and the
   * indicator gets stuck on "syncing" for a database that's actually perfectly caught up
   * (see #33's original plugin-health follow-up, since moved off PouchDB sync entirely - see
   * #49 - but the mechanism itself stays generically useful for any future noisy doc). A
   * change batch made up ENTIRELY of noise ids is treated as an immediate settle instead of
   * 'active'.
   */
  isNoiseDocId?: (id: string) => boolean
}

/**
 * Every workspace-scoped collection (songs, setlists, dashboards, ...) starts its own live
 * `.sync()` independently - there is no single PouchDB sync object anywhere (see #33). This
 * wraps `local.sync(remote, ...)` so all ~9 call sites report into the shared useSyncStore
 * the same way, instead of each duplicating its own change/paused/active/error listeners -
 * and, per the queue above, so they don't all start at once either.
 *
 * `name` identifies the stream in the store (e.g. the collection's `kind`, or
 * 'plugin-health'); it just needs to be unique across the app's sync call sites.
 */
export function trackedSync<T extends object>(
  name: string,
  local: PouchDB.Database<T>,
  remote: PouchDB.Database<T>,
  options: TrackedSyncOptions = {},
): TrackedSync {
  let cancelled = false
  let realSync: PouchDB.Replication.Sync<T> | null = null

  const turn = startQueue.then(
    () =>
      new Promise<void>((resolveSettled) => {
        if (cancelled) {
          resolveSettled()
          return
        }

        const { setStreamStatus, clearStream } = useSyncStore.getState()
        const sync = local.sync(remote, { live: true, retry: true })
        realSync = sync

        let settled = false
        const settle = () => {
          if (settled) return
          settled = true
          resolveSettled()
        }

        // Centralizes "does this status transition also free up the next queued stream":
        // anything other than 'active' means this stream isn't mid-batch right now.
        const report = (status: 'active' | 'paused' | 'offline' | 'error') => {
          setStreamStatus(name, status)
          if (status !== 'active') settle()
        }

        report('active')

        sync
          .on('active', () => report('active'))
          .on('change', (info) => {
            const docs = info.change.docs
            const isNoiseOnly = docs.length > 0 && docs.every((doc) => options.isNoiseDocId?.(doc._id) ?? false)
            report(isNoiseOnly ? 'paused' : 'active')
          })
          // PouchDB passes an `err` here specifically when a live sync paused because of a
          // disconnect (it will keep retrying under the hood); with no `err` it paused
          // because it's simply caught up, which is the "Synced" state from the
          // Acceptance Criteria.
          .on('paused', (err) => report(err ? 'offline' : 'paused'))
          .on('error', () => report('error'))
          // Fires when a live sync is cancelled (e.g. switching workspace) - the stream is
          // gone for good at that point, so it should stop contributing to the aggregate
          // status rather than linger at whatever it last reported.
          .on('complete', () => {
            clearStream(name)
            settle()
          })
      }),
  )

  // One stream that never settles shouldn't jam every stream queued behind it.
  startQueue = turn.catch(() => undefined)

  return {
    cancel: () => {
      cancelled = true
      realSync?.cancel()
    },
  }
}
