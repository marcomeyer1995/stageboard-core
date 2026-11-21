import { z } from 'zod'

/** The word older bands stored for "the host's own hardware or plug-in". It is **legacy** (#964): a band now names the host by its id, like a tablet by its
 * id (`hostTargetOf`), and the host that serves a band rewrites what it finds (`core-backend/src/migrations/hostTarget.ts`). It stays here only so such data
 * still reads - `isHostTarget` and `migrateExecutionTarget` - and as the answer while no host has said who it is. Nothing new is written with it. */
export const LEGACY_HOST_TARGET = 'server'

/** The id of a device - a tablet or a host (`Device.id`, `hostId`) - or the legacy word above. */
export const ExecutionTargetSchema = z.string().min(1)
export type ExecutionTarget = z.infer<typeof ExecutionTargetSchema>

/**
 * Who a binding's `executionTarget` points at. Hardware that sits on a host (a laptop's MIDI port, a host plug-in) is bound to that host's own id
 * (`hostId`, #964) - the same kind of id as a tablet's `Device.id` - and not to a reserved word. The reserved word `'server'` is what older
 * bindings stored; it still reads as "the host" until the migration has rewritten it (`migrateExecutionTarget`).
 *
 * `hostIds`: the ids of the hosts the device knows (the one it talks to, the band's listed hosts). `deviceIds`: the band's roster. A tablet that is a
 * host has its device id as host id - a binding to it is its own output, not a host plug-in - so an id the roster knows is a device, whatever else it is.
 */
export interface TargetWorld {
  hostIds: readonly string[]
  deviceIds: readonly string[]
  /** The host this device talks to, once it has said who it is. */
  currentHostId?: string | undefined
}

/** The binding means "the host's own hardware or plug-in": the legacy word, or a host id that no roster device carries. */
export function isHostTarget(target: string | null | undefined, world: TargetWorld): boolean {
  if (!target) return false
  if (target === LEGACY_HOST_TARGET) return true
  return world.hostIds.includes(target) && !world.deviceIds.includes(target)
}

/** A stored target as it should read now: the legacy word becomes the id of the host that answers (kept as it is while no host id is known). */
export function migrateExecutionTarget(target: string | null | undefined, currentHostId: string | undefined): string | null {
  if (!target) return null
  return target === LEGACY_HOST_TARGET && currentHostId ? currentHostId : target
}

/** What a new binding to "the host's own hardware" stores: the id of the host that answers (the legacy word only while no host has said who it is). */
export function hostTargetOf(world: TargetWorld): string {
  return world.currentHostId ?? LEGACY_HOST_TARGET
}
