import { describe, expect, it } from 'vitest'
import { hostDeviceDoc } from './registerHostDevice.js'

describe('hostDeviceDoc (#964)', () => {
  it('makes the host a registered entry under its own id, marked as a host', () => {
    expect(hostDeviceDoc(null, 'stage-pc', 'Stage-PC', 1000)).toEqual({ _id: 'devices:stage-pc', id: 'stage-pc', name: 'Stage-PC', lastSeenAt: 1000, firstSeenAt: 1000, revoked: false, host: true })
  })
  it('keeps what the band made of it - the name an admin gave, the first time it was seen - and only refreshes lastSeenAt', () => {
    const existing = { _id: 'devices:stage-pc', _rev: '2-x', id: 'stage-pc', name: 'Bühnenrechner', lastSeenAt: 10, firstSeenAt: 5, revoked: false, host: true }
    expect(hostDeviceDoc(existing, 'stage-pc', 'Stage-PC', 1000)).toEqual({ ...existing, lastSeenAt: 1000 })
  })
})
