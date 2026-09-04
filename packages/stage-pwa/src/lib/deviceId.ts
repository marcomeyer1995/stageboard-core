const STORAGE_KEY = 'stageboard-device-id'

/**
 * A random id this specific browser/tablet install generates once and keeps forever - plain
 * `localStorage`, not a Zustand store, since it never needs to be reactive. Not tied to any
 * account: the whole point is telling apart "one device online" from "the same account open
 * on three tablets at once" (`usePresenceReporter.ts`, `BandManagementView.tsx`), something
 * per-profile state alone can't represent.
 *
 * The single device identity for the whole app - `useShowStateStore.ts`'s Master-Token
 * (`masterHolderId`) and device claims (`deviceClaims`) use this exact same id, not a
 * separately-generated one (unified 2026-09-04, while scoping #10's DeviceRegistry slice:
 * found two independent per-device ids coexisting with nothing linking them).
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}
