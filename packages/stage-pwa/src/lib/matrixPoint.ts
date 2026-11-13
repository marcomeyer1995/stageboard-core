import type { Crosspoint, MatrixPoint } from 'shared-types'

/** Two rows/columns of a routing matrix are the same: the same virtual port (and side of it), or the same port, channel and pin. */
export const samePoint = (a: MatrixPoint, b: MatrixPoint): boolean =>
  a.kind === 'virtual' ? b.kind === 'virtual' && a.virtualPortId === b.virtualPortId && a.channel === b.channel : b.kind === 'port' && a.portId === b.portId && a.channel === b.channel && a.pin === b.pin

/**
 * Which side of a stereo source a routed cell carries (2026-11-12), as the sound plays it
 * (`outputFeeds`): "Track L" / "Track R" say so themselves; the whole track on both pins or on
 * channels 1 and 2 of one port goes left on 1, right on 2. On one alone it is summed - no letter.
 */
export function stereoBadge(crosspoints: readonly Crosspoint[], from: MatrixPoint, to: MatrixPoint, stereo: (virtualPortId: string) => boolean): string | undefined {
  if (from.kind !== 'virtual' || to.kind !== 'port' || !stereo(from.virtualPortId)) return undefined
  if (from.channel === 1 || from.channel === 2) return from.channel === 1 ? 'L' : 'R'
  const index = (p: MatrixPoint) => (p.kind === 'port' ? (p.pin ?? p.channel) : undefined)
  const here = index(to)
  if (here !== 1 && here !== 2) return undefined
  const taken = new Set(crosspoints.filter((c) => c.from.kind === 'virtual' && c.from.virtualPortId === from.virtualPortId && c.from.channel === undefined && c.to.kind === 'port' && c.to.portId === to.portId).map((c) => index(c.to)))
  return taken.has(1) && taken.has(2) ? (here === 1 ? 'L' : 'R') : undefined
}
