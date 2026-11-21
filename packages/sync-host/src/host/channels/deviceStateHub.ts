import { checkStateValue, type DeviceStateEvent, type StateField } from 'shared-types'

/**
 * Device state for every device of a band (docs/36 §5a, #964): the latest value of every state field of every device, shared with whoever follows the
 * band, and replayed to a device that connects later - the same shape as the switch states (docs/23 §11.5). In memory: a restart forgets it, and the
 * add-on that publishes it says it again with its next change. What the fields are is **declared** by the add-on; a value that does not fit its field is
 * dropped here, so no add-on can put nonsense - or a field it never declared - on every screen of the band.
 */
type Listener = (event: DeviceStateEvent) => void
const listeners = new Map<string, Set<Listener>>()
/** Per band: `device\0key` -> the latest event. */
const latest = new Map<string, Map<string, DeviceStateEvent>>()

const MAX_FIELDS_PER_BAND = 500

export function subscribe(workspaceId: string, listener: Listener): () => void {
  const set = listeners.get(workspaceId) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(workspaceId, set)
  for (const event of latest.get(workspaceId)?.values() ?? []) listener(event)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(workspaceId)
  }
}

export type PublishResult = { ok: true; devices: number } | { ok: false; reason: string }

/**
 * Records a value an add-on published and sends it to every follower of the band. `declared` are the fields the add-on's device declared: a key that is
 * not among them, or a value that does not fit, is refused with its reason (the caller logs it; nothing reaches the band).
 */
export function publish(workspaceId: string, event: DeviceStateEvent, declared: Readonly<Record<string, StateField>>): PublishResult {
  const field = Object.prototype.hasOwnProperty.call(declared, event.key) ? declared[event.key] : undefined
  if (!field) return { ok: false, reason: `the add-on declared no state field "${event.key}"` }
  const check = checkStateValue(field, event.value)
  if (!check.ok) return { ok: false, reason: `"${event.key}": ${check.reason}` }
  const map = latest.get(workspaceId) ?? new Map<string, DeviceStateEvent>()
  const id = `${event.device}\u0000${event.key}`
  if (!map.has(id) && map.size >= MAX_FIELDS_PER_BAND) return { ok: false, reason: 'too many state fields for this band' }
  map.set(id, event)
  latest.set(workspaceId, map)
  const set = listeners.get(workspaceId)
  for (const listener of set ?? []) listener(event)
  return { ok: true, devices: set?.size ?? 0 }
}

/** The latest values of a band - what a device that just connected is told. */
export function snapshot(workspaceId: string): DeviceStateEvent[] {
  return [...(latest.get(workspaceId)?.values() ?? [])]
}

export function __resetForTests(): void {
  listeners.clear()
  latest.clear()
}
