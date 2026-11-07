import type { MatrixPoint } from 'shared-types'

/** Two rows/columns of a routing matrix are the same: the same virtual port, or the same port and channel. */
export const samePoint = (a: MatrixPoint, b: MatrixPoint): boolean =>
  a.kind === 'virtual' ? b.kind === 'virtual' && a.virtualPortId === b.virtualPortId : b.kind === 'port' && a.portId === b.portId && a.channel === b.channel
