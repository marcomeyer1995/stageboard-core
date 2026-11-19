import { createHostPresence, type HostPresence } from 'sync-host'

/**
 * The Stage-Server's presence (who is logged in from which device, the master's heartbeat, the Ready Check, the
 * Stage-Messenger message): the one store every host uses (`sync-host`'s `createHostPresence`, #949) - this module
 * only holds the single instance of this process. In memory by design: a fresh restart legitimately does not know
 * anyone is online until they report again.
 */
let store: HostPresence = createHostPresence({ now: () => Date.now() })

/** What the routes hold on to: it always talks to the current instance, so a reset (tests) is seen by routes already built. */
const current: HostPresence = {
  setEntry: (...args) => store.setEntry(...args),
  setMasterHeartbeat: (...args) => store.setMasterHeartbeat(...args),
  setReady: (...args) => store.setReady(...args),
  setFlash: (...args) => store.setFlash(...args),
  snapshot: (...args) => store.snapshot(...args),
  subscribe: (...args) => store.subscribe(...args),
}

export const presence = (): HostPresence => current

/** Test-only: this instance is shared across the whole process by design (one server, many bands) - tests need
 * a way to reset it between runs. */
export function __resetPresenceStoreForTests(now: () => number = () => Date.now()): void {
  store = createHostPresence({ now })
}
