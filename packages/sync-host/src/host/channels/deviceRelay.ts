import type { DeviceTrigger } from 'shared-types'

type Subscriber = (trigger: DeviceTrigger) => void

/**
 * Point-to-point relay for #10's generalized device claims: unlike presenceStore.ts/healthStore.ts
 * (broadcast the latest snapshot to every subscriber), a device-claim trigger (a lighting cue, a
 * mixer fader move) is a one-shot event meant for exactly the one tablet claimed for that
 * capability right now - so this keys subscribers by (workspaceId, deviceId) instead of just
 * workspaceId, and `relay` fans out only to that key's subscribers (normally the one tablet
 * that has `GET .../trigger-stream` open), not the whole workspace.
 *
 * Deliberately not persisted, same reasoning as presenceStore.ts: a trigger that arrives while
 * nobody's listening (device offline, page not open) has no meaningful "catch up later" replay -
 * `relay`'s boolean return tells the caller whether anyone was actually there to receive it.
 */
const subscribersByKey = new Map<string, Set<Subscriber>>()

function keyFor(workspaceId: string, deviceId: string): string {
  return `${workspaceId}:${deviceId}`
}

export function subscribe(workspaceId: string, deviceId: string, subscriber: Subscriber): () => void {
  const key = keyFor(workspaceId, deviceId)
  const subscribers = subscribersByKey.get(key) ?? new Set<Subscriber>()
  subscribers.add(subscriber)
  subscribersByKey.set(key, subscribers)

  return () => {
    subscribers.delete(subscriber)
  }
}

/** Returns whether at least one subscriber (i.e. the claimed device's own open trigger-stream)
 * actually received the trigger - callers surface `false` back to whoever fired the cue as
 * "Zielgerät nicht verbunden" rather than silently pretending it worked. */
export function relay(workspaceId: string, deviceId: string, trigger: DeviceTrigger): boolean {
  const subscribers = subscribersByKey.get(keyFor(workspaceId, deviceId))
  if (!subscribers || subscribers.size === 0) return false
  for (const subscriber of subscribers) subscriber(trigger)
  return true
}

/** Test-only: this module's state is shared across the whole process by design - tests need a
 * way to reset it between runs. */
export function __resetDeviceRelayForTests(): void {
  subscribersByKey.clear()
}
