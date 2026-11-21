import type { TargetWorld } from 'shared-types'

/** What a binding's `executionTarget` is read against (#964): the hosts this device knows (the one it talks to and the band's listed ones) and the roster. */
export function targetWorldOf(args: { currentHostId: string | undefined; listedHostIds: readonly string[]; deviceIds: readonly string[] }): TargetWorld {
  const hostIds = [...new Set([...(args.currentHostId ? [args.currentHostId] : []), ...args.listedHostIds])]
  return { hostIds, deviceIds: args.deviceIds, currentHostId: args.currentHostId }
}

/** Before anything is known: only the legacy word `'server'` reads as a host. */
export const NO_WORLD: TargetWorld = { hostIds: [], deviceIds: [] }
