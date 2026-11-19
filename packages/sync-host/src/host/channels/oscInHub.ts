import type { OscInMessage } from 'shared-types'

/**
 * OSC messages the Stage-Server received (#484, OSC as a trigger), to every device of the band
 * listening - in practice the master that runs the rules, and a device learning a button. In
 * memory, nothing replayed: a trigger that arrives while nobody listens is gone, like a pedal
 * pressed with the app closed.
 */
type Listener = (message: OscInMessage) => void
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

/** Sends the message to every listener of the band; returns how many got it. */
export function broadcast(workspaceId: string, message: OscInMessage): number {
  const set = listeners.get(workspaceId)
  if (!set) return 0
  for (const listener of set) listener(message)
  return set.size
}

export function __resetForTests(): void {
  listeners.clear()
}
