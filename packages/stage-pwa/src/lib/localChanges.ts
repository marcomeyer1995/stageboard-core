/**
 * One live local `.changes()` feed per PouchDB instance, shared by every collection and store,
 * instead of one filtered feed each.
 *
 * Why (found 2026-09-27, tablet froze ~1 s on every Play): a PouchDB live feed with a `filter`
 * only moves its position forward on changes that pass the filter. Every store watched the one
 * shared workspace db through its own filtered feed, so after any write each feed re-read every
 * change since it was opened - a window that grows all session long, since the show-state
 * heartbeat writes every few seconds - and for each row PouchDB parses the document's metadata
 * (show-state's revision tree: ~118 KB). One write cost ~270 of those parses, ~30 MB of JSON,
 * 1.2 s of CPU plus as much garbage collection, getting worse the longer the app ran.
 *
 * An unfiltered feed advances on every change, so a write now costs one row, read once, and is
 * handed to whichever subscribers want that document id.
 */

export interface LocalChange<T> {
  id: string
  seq: number | string
  deleted?: boolean
  doc?: T & { _id: string; _rev: string }
}

export interface LocalChangesHandle<T> {
  on(event: 'change', listener: (change: LocalChange<T>) => void): LocalChangesHandle<T>
  cancel(): void
}

interface Subscriber {
  matches: (id: string) => boolean
  listeners: ((change: LocalChange<unknown>) => void)[]
}

interface Feed {
  handle: { cancel(): void }
  subscribers: Set<Subscriber>
}

const feeds = new WeakMap<object, Feed>()

function feedFor(db: PouchDB.Database<object>): Feed {
  const existing = feeds.get(db)
  if (existing) return existing
  const subscribers = new Set<Subscriber>()
  const handle = db.changes({ since: 'now', live: true, include_docs: true })
  handle.on('change', (change) => {
    // A copy: a listener may cancel (and so unsubscribe) while this loop runs.
    for (const subscriber of [...subscribers]) {
      if (!subscriber.matches(change.id)) continue
      for (const listener of subscriber.listeners) listener(change as LocalChange<unknown>)
    }
  })
  handle.on('error', (error: unknown) => console.warn('[localChanges] feed error', error))
  const feed = { handle, subscribers }
  feeds.set(db, feed)
  return feed
}

/**
 * Live changes to the documents of `db` whose id `matches` - from now on, like `since: 'now'`.
 * The feed behind it is shared per db, started with the first subscriber and stopped after the
 * last one cancels.
 */
export function watchLocalChanges<T>(
  db: PouchDB.Database<object>,
  matches: (id: string) => boolean,
): LocalChangesHandle<T> {
  const feed = feedFor(db)
  const subscriber: Subscriber = { matches, listeners: [] }
  feed.subscribers.add(subscriber)
  let cancelled = false
  const handle: LocalChangesHandle<T> = {
    on(_event, listener) {
      subscriber.listeners.push(listener as (change: LocalChange<unknown>) => void)
      return handle
    },
    cancel() {
      if (cancelled) return
      cancelled = true
      feed.subscribers.delete(subscriber)
      if (feed.subscribers.size === 0) {
        feed.handle.cancel()
        feeds.delete(db)
      }
    },
  }
  return handle
}
