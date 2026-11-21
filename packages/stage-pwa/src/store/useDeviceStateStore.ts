import { create } from 'zustand'
import type { DeviceStateEvent } from 'shared-types'
import { subscribeToDeviceState } from '../lib/deviceStateStream'

/** `state:<device>.<key>` binds read this: the latest value per device and field, as the host last said (`resolveBind`, lib/addonUi/bind.ts). */
export type DeviceStateValues = Record<string, Record<string, unknown>>

interface DeviceStateStore {
  values: DeviceStateValues
  /** Applies one event: the newest value of a field wins; an older one (a replay, a late message) is ignored. */
  apply: (event: DeviceStateEvent) => void
  init: (workspaceId: string) => Promise<void>
}

let unsubscribe: (() => void) | null = null
const times = new Map<string, number>()

/** The live device state of the active band - one shared subscription, re-opened on every workspace change (like the presence store). */
export const useDeviceStateStore = create<DeviceStateStore>((set, get) => ({
  values: {},
  apply: (event) => {
    const id = `${event.device}\u0000${event.key}`
    if ((times.get(id) ?? -1) > event.at) return
    times.set(id, event.at)
    const current = get().values
    set({ values: { ...current, [event.device]: { ...(current[event.device] ?? {}), [event.key]: event.value } } })
  },
  init: async (workspaceId) => {
    unsubscribe?.()
    unsubscribe = null
    times.clear()
    set({ values: {} })
    unsubscribe = subscribeToDeviceState(workspaceId, (event) => get().apply(event))
  },
}))
