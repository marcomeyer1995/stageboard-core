import type { SwitchStateEvent } from 'shared-types'

/**
 * Switch states for every device of a band (docs/23 §11.5): changes go to every subscriber at
 * once, and a device that connects later first gets the current picture - each rastend switch's
 * last on/off and who holds a tastend one right now. In memory: a restart forgets it, and the
 * devices send it again with their next change or heartbeat.
 */
type Listener = (event: SwitchStateEvent) => void
const listeners = new Map<string, Set<Listener>>()
/** Per band: the last on/off per switch, and the last `held` per switch + device (with when it came). */
const latched = new Map<string, Map<string, SwitchStateEvent>>()
const held = new Map<string, Map<string, { event: SwitchStateEvent; receivedAt: number }>>()

/** A holder that sent nothing for this long has dropped out (docs/23 §11.10: 3 s). */
export const HOLD_TIMEOUT_MS = 3_000

export function subscribe(workspaceId: string, listener: Listener, now = Date.now()): () => void {
  const set = listeners.get(workspaceId) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(workspaceId, set)
  for (const event of latched.get(workspaceId)?.values() ?? []) listener(event)
  for (const { event, receivedAt } of held.get(workspaceId)?.values() ?? []) if (now - receivedAt < HOLD_TIMEOUT_MS) listener(event)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(workspaceId)
  }
}

/** Records the change and sends it to every subscriber of the band; returns how many got it. */
export function broadcast(workspaceId: string, event: SwitchStateEvent, now = Date.now()): number {
  if (event.kind === 'on' || event.kind === 'off') {
    const map = latched.get(workspaceId) ?? new Map<string, SwitchStateEvent>()
    map.set(event.switchId, event)
    latched.set(workspaceId, map)
  } else {
    const map = held.get(workspaceId) ?? new Map<string, { event: SwitchStateEvent; receivedAt: number }>()
    const key = `${event.switchId}\u0000${event.deviceId}`
    if (event.kind === 'held') map.set(key, { event, receivedAt: now })
    else map.delete(key)
    held.set(workspaceId, map)
  }
  const set = listeners.get(workspaceId)
  if (!set) return 0
  for (const listener of set) listener(event)
  return set.size
}

export function __resetForTests(): void {
  listeners.clear()
  latched.clear()
  held.clear()
}
