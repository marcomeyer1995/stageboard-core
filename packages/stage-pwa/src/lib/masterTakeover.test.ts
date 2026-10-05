import { describe, expect, it } from 'vitest'
import { MASTER_HEARTBEAT_TIMEOUT_MS } from 'shared-types'
import { canClaimMaster, getMasterStatus, masterSelfCheck } from './masterTakeover'

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

describe('masterSelfCheck (#378 option B)', () => {
  const base = { deviceId: 'me', now: 100_000, holdingSince: 0, hasStageServer: true }
  const beat = (deviceId: string, at: number) => ({ deviceId, at })

  it("passes while the server confirms this device's heartbeat", () => {
    expect(masterSelfCheck({ ...base, syncStatus: 'idle', heartbeat: beat('me', 95_000) })).toBe('ok')
  })

  it('fails with a dead sync or offline, whatever the heartbeat says', () => {
    expect(masterSelfCheck({ ...base, syncStatus: 'error', heartbeat: beat('me', 99_000) })).toBe('sync-error')
    expect(masterSelfCheck({ ...base, syncStatus: 'offline', heartbeat: beat('me', 99_000) })).toBe('offline')
  })

  it("fails when the latest heartbeat is another device's or stale", () => {
    expect(masterSelfCheck({ ...base, syncStatus: 'idle', heartbeat: beat('phone', 99_000) })).toBe('unconfirmed')
    expect(masterSelfCheck({ ...base, syncStatus: 'idle', heartbeat: beat('me', 80_000) })).toBe('unconfirmed')
    expect(masterSelfCheck({ ...base, syncStatus: 'idle', heartbeat: null })).toBe('unconfirmed')
  })

  it('always passes without a Stage-Server (local-only band) - nothing to confirm against', () => {
    expect(masterSelfCheck({ ...base, hasStageServer: false, syncStatus: 'offline', heartbeat: null })).toBe('ok')
    expect(masterSelfCheck({ ...base, hasStageServer: false, syncStatus: 'idle', heartbeat: null })).toBe('ok')
  })

  it('gives a fresh holder one timeout to get its first beats confirmed', () => {
    expect(masterSelfCheck({ ...base, syncStatus: 'syncing', heartbeat: null, holdingSince: 90_000 })).toBe('ok')
  })
})

