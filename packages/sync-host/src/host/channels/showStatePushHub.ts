import type { ShowStatePush } from 'shared-types'

/**
 * Pushes a master's show-state change to every device of the band at once (#468). In memory only:
 * the database stays the record - this is just the fast lane, so an ahead-of-time Play reaches every
 * device before it must sound (through replication alone a slow tablet took up to 1 s).
 */
type Listener = (push: ShowStatePush) => void
const listeners = new Map<string, Set<Listener>>()

export function subscribe(workspaceId: string, listener: Listener): () => void {
  const set = listeners.get(workspaceId) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(workspaceId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(workspaceId)
  }
}

/** Sends the change to every subscriber of the band; returns how many devices got it. */
export function broadcast(workspaceId: string, push: ShowStatePush): number {
  const set = listeners.get(workspaceId)
  if (!set) return 0
  for (const listener of set) listener(push)
  return set.size
}

export function __resetForTests(): void {
  listeners.clear()
}
