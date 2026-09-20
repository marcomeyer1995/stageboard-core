import { describe, expect, it } from 'vitest'
import { MASTER_HEARTBEAT_TIMEOUT_MS } from 'shared-types'
import { canClaimMaster, getMasterStatus } from './masterTakeover'

const NOW = 1_000_000

describe('getMasterStatus', () => {
  const base = { deviceId: 'me', now: NOW }

  it('is vacant with no holder', () => {
    expect(getMasterStatus({ ...base, holderId: null, heartbeat: null })).toBe('vacant')
  })

  it('is self when this device holds the token, regardless of heartbeat', () => {
    expect(getMasterStatus({ ...base, holderId: 'me', heartbeat: null })).toBe('self')
  })

  it('is alive while the holder beat within the timeout', () => {
    const heartbeat = { deviceId: 'other', at: NOW - MASTER_HEARTBEAT_TIMEOUT_MS }
    expect(getMasterStatus({ ...base, holderId: 'other', heartbeat })).toBe('alive')
  })

  it('is stale once the holder has not beaten for longer than the timeout', () => {
    const heartbeat = { deviceId: 'other', at: NOW - MASTER_HEARTBEAT_TIMEOUT_MS - 1 }
    expect(getMasterStatus({ ...base, holderId: 'other', heartbeat })).toBe('stale')
  })

  it('is stale when no beat was ever seen (e.g. right after a server restart)', () => {
    expect(getMasterStatus({ ...base, holderId: 'other', heartbeat: undefined })).toBe('stale')
  })

  it("ignores a fresh beat from a device that is not the holder", () => {
    const heartbeat = { deviceId: 'old-master', at: NOW }
    expect(getMasterStatus({ ...base, holderId: 'other', heartbeat })).toBe('stale')
  })
})

describe('canClaimMaster', () => {
  it('lets anyone claim a vacant or stale token', () => {
    expect(canClaimMaster('vacant', [])).toBe(true)
    expect(canClaimMaster('stale', ['performer'])).toBe(true)
  })

  it('never lets the holder claim again', () => {
    expect(canClaimMaster('self', ['admin'])).toBe(false)
  })

  it('restricts taking over a live master to admin and showmaster', () => {
    expect(canClaimMaster('alive', [])).toBe(false)
    expect(canClaimMaster('alive', ['performer', 'crew'])).toBe(false)
    expect(canClaimMaster('alive', ['admin'])).toBe(true)
    expect(canClaimMaster('alive', ['performer', 'showmaster'])).toBe(true)
  })
})
