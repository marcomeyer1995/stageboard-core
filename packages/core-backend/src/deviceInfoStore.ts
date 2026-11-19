import { createHostDeviceInfo, type HostDeviceInfo } from 'sync-host'

/**
 * What the Host knows about each device (the Device Ledger): the one store every host uses
 * (`sync-host`'s `createHostDeviceInfo`, #949) - this module only holds the single instance of this process, and
 * the plain functions `pingLoop.ts` walks the devices with. In memory by design: a restart knows nothing about any
 * device until it hears from it again.
 */
let store: HostDeviceInfo = createHostDeviceInfo({ now: () => Date.now() })

/** What the routes hold on to: it always talks to the current instance, so a reset (tests) is seen by routes already built. */
const current: HostDeviceInfo = {
  report: (...args) => store.report(...args),
  setEntry: (...args) => store.setEntry(...args),
  patchEntry: (...args) => store.patchEntry(...args),
  snapshot: (...args) => store.snapshot(...args),
  subscribe: (...args) => store.subscribe(...args),
  allEntries: () => store.allEntries(),
}

export const deviceInfo = (): HostDeviceInfo => current

export const getSnapshot = (workspaceId: string) => store.snapshot(workspaceId)
export const setEntry = (...args: Parameters<HostDeviceInfo['setEntry']>) => store.setEntry(...args)
export const patchEntry = (...args: Parameters<HostDeviceInfo['patchEntry']>) => store.patchEntry(...args)
export const subscribe = (...args: Parameters<HostDeviceInfo['subscribe']>) => store.subscribe(...args)
export const allEntries = () => store.allEntries()

/** Test-only: this instance is shared across the whole process by design (one server, many bands) - tests need
 * a way to reset it between runs. */
export function __resetDeviceInfoStoreForTests(now: () => number = () => Date.now()): void {
  store = createHostDeviceInfo({ now })
}
