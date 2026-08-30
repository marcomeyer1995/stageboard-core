import type { PluginHealth, PluginHealthEntry } from 'shared-types'

type Subscriber = (snapshot: PluginHealth) => void

/**
 * In-memory, per-workspace plugin/hardware liveness state - replaces the CouchDB
 * `plugin-health` doc pluginSync.ts used to write (see #49 follow-up). A heartbeat has no
 * offline/multi-master value, so it doesn't belong in a synced database at all; this module
 * is the shared source of truth both the Stage-Server's own heartbeat (pluginSync.ts) and a
 * tablet's self-report (`POST /plugin-health/:workspaceId/report` in index.ts) write into,
 * and `GET /plugin-health/:workspaceId/stream` reads from.
 *
 * Deliberately not persisted anywhere: a fresh restart legitimately doesn't know anything is
 * online until it hears otherwise again - same behavior as before, just not backed by disk.
 */
const stateByWorkspace = new Map<string, Map<string, PluginHealthEntry>>()
const subscribersByWorkspace = new Map<string, Set<Subscriber>>()

function snapshotFor(workspaceId: string): PluginHealth {
  const plugins = stateByWorkspace.get(workspaceId)
  return { plugins: plugins ? Object.fromEntries(plugins) : {} }
}

export function getSnapshot(workspaceId: string): PluginHealth {
  return snapshotFor(workspaceId)
}

/** Sets one plugin's entry and pushes the whole updated snapshot to every subscriber - a
 * full snapshot, not a delta, so subscribers never need merge logic (the payload is tiny:
 * a handful of plugins at most). */
export function setEntry(workspaceId: string, pluginName: string, entry: PluginHealthEntry): void {
  const plugins = stateByWorkspace.get(workspaceId) ?? new Map<string, PluginHealthEntry>()
  plugins.set(pluginName, entry)
  stateByWorkspace.set(workspaceId, plugins)

  const snapshot = snapshotFor(workspaceId)
  for (const subscriber of subscribersByWorkspace.get(workspaceId) ?? []) {
    subscriber(snapshot)
  }
}

/**
 * Calls `subscriber` immediately with the current snapshot - this is what makes a
 * reconnecting tablet catch up right away instead of waiting for the next change - then
 * again on every future update for that workspace. Returns an unsubscribe function.
 */
export function subscribe(workspaceId: string, subscriber: Subscriber): () => void {
  const subscribers = subscribersByWorkspace.get(workspaceId) ?? new Set<Subscriber>()
  subscribers.add(subscriber)
  subscribersByWorkspace.set(workspaceId, subscribers)
  subscriber(snapshotFor(workspaceId))

  return () => {
    subscribers.delete(subscriber)
  }
}

/** Test-only: this module's state is shared across the whole process by design (one server,
 * many workspaces) - tests need a way to reset it between runs. */
export function __resetHealthStoreForTests(): void {
  stateByWorkspace.clear()
  subscribersByWorkspace.clear()
}
